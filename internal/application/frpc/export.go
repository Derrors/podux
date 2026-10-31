package frpc

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"

	v1 "github.com/fatedier/frp/pkg/config/v1"
	"github.com/pelletier/go-toml/v2"
)

// RedactedValue replaces secrets in an export made without them.
const RedactedValue = "<redacted>"

// secretKeys are config keys whose values are credentials; matched case-insensitively.
var secretKeys = map[string]bool{
	"token": true, "password": true, "secretkey": true, "clientsecret": true, "httppassword": true,
}

// Exported TLS files, relative to the exported frpc.toml.
const (
	exportCertFile   = "certs/cert.pem"
	exportKeyFile    = "certs/key.pem"
	exportCAFile     = "certs/ca.pem"
	exportOIDCCAFile = "certs/oidc-ca.pem"
)

// ExportToml renders a server's configuration as an frpc.toml that native frpc can
// run: the common section, its enabled proxies and its enabled visitors, with the
// same "<name>-<id>" names Podux runs them under. Without includeSecrets, tokens,
// secret keys and passwords are replaced with RedactedValue. TLS certificates are
// referenced as files under certs/, which the header comment lists.
func (fs *Service) ExportToml(serverID string, includeSecrets bool) ([]byte, error) {
	common, err := fs.buildCommonCfg(&serverID)
	if err != nil {
		return nil, err
	}
	proxies, err := fs.genProxyCfgs(&serverID)
	if err != nil {
		return nil, err
	}
	visitors, err := fs.genVisitorCfgs(&serverID)
	if err != nil {
		return nil, err
	}

	var files []string
	tls := &common.Transport.TLS
	if tls.Enable == nil || *tls.Enable {
		if tls.CertFile != "" && tls.KeyFile != "" {
			tls.CertFile, tls.KeyFile = exportCertFile, exportKeyFile
			files = append(files, exportCertFile, exportKeyFile)
		} else {
			tls.CertFile, tls.KeyFile = "", ""
		}
		if tls.TrustedCaFile != "" {
			tls.TrustedCaFile = exportCAFile
			files = append(files, exportCAFile)
		}
	}

	if common.Auth.OIDC.TrustedCaFile != "" {
		common.Auth.OIDC.TrustedCaFile = exportOIDCCAFile
		files = append(files, exportOIDCCAFile)
	}

	files = append(files, exportPluginCerts(proxies)...)

	var out bytes.Buffer
	out.WriteString("# frpc configuration exported from Podux / 由 Podux 导出的 frpc 配置\n")
	out.WriteString("# Proxy and visitor names are \"<name>-<Podux ID>\", as Podux runs them on frps.\n")
	if !includeSecrets {
		fmt.Fprintf(&out, "# Secrets were replaced with %q; fill them in before use. / 密钥已替换为 %q，使用前请填写。\n", RedactedValue, RedactedValue)
	}
	for _, f := range files {
		fmt.Fprintf(&out, "# Save the TLS file from the Podux settings as %s / 请把 Podux 中配置的证书内容保存为 %s\n", f, f)
	}
	out.WriteString("\n")

	sections := []struct {
		key   string
		value any
	}{
		{"", common},
		{"proxies", proxies},
		{"visitors", visitors},
	}
	for _, sec := range sections {
		doc, err := toPlain(sec.value, includeSecrets)
		if err != nil {
			return nil, err
		}
		if doc == nil {
			continue
		}
		if sec.key != "" {
			doc = map[string]any{sec.key: doc}
		}
		b, err := toml.Marshal(doc)
		if err != nil {
			return nil, err
		}
		out.Write(b)
		out.WriteString("\n")
	}
	return bytes.TrimRight(out.Bytes(), "\n"), nil
}

// toPlain converts frp config structs to plain maps through their JSON tags (the
// same keys frpc reads from TOML), drops empty values and redacts secrets.
// It returns nil when nothing is left.
func toPlain(v any, includeSecrets bool) (any, error) {
	if list, ok := v.([]v1.ProxyConfigurer); ok && len(list) == 0 {
		return nil, nil
	}
	if list, ok := v.([]v1.VisitorConfigurer); ok && len(list) == 0 {
		return nil, nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var plain any
	if err := json.Unmarshal(b, &plain); err != nil {
		return nil, err
	}
	return prune(plain, includeSecrets), nil
}

// prune removes nulls, empty strings, zero numbers and empty tables/arrays, which
// frp treats as unset (it fills in defaults for zeros, e.g. log.maxDays), so the
// export only shows configured values. false is kept: tls.enable = false matters.
func prune(v any, includeSecrets bool) any {
	switch t := v.(type) {
	case map[string]any:
		for k, val := range t {
			if !includeSecrets && secretKeys[strings.ToLower(k)] {
				if s, ok := val.(string); ok && s != "" {
					t[k] = RedactedValue
					continue
				}
			}
			p := prune(val, includeSecrets)
			// A health check without a type is off; frp still marshals its intervalSeconds.
			if hc, ok := p.(map[string]any); ok && k == "healthCheck" && hc["type"] == nil {
				p = nil
			}
			if p == nil {
				delete(t, k)
			} else {
				t[k] = p
			}
		}
		if len(t) == 0 {
			return nil
		}
		return t
	case []any:
		out := t[:0]
		for _, val := range t {
			if p := prune(val, includeSecrets); p != nil {
				out = append(out, p)
			}
		}
		if len(out) == 0 {
			return nil
		}
		return out
	case string:
		if t == "" {
			return nil
		}
		return t
	case nil:
		return nil
	case float64:
		if t == 0 {
			return nil
		}
		// JSON numbers decode as float64; keep whole numbers as TOML integers (7000, not 7000.0).
		if t == float64(int64(t)) {
			return int64(t)
		}
		return t
	default:
		return t
	}
}
