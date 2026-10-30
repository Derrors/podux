package frpc

import (
	"os"
	"path/filepath"
	"strings"

	v1 "github.com/fatedier/frp/pkg/config/v1"
)

// pluginCertFields returns the certificate and key fields of plugins that terminate
// TLS (https2http, https2https, tls2raw), or nil for other plugins.
func pluginCertFields(cfg v1.ProxyConfigurer) (crt, key *string) {
	switch o := cfg.GetBaseConfig().Plugin.ClientPluginOptions.(type) {
	case *v1.HTTPS2HTTPPluginOptions:
		return &o.CrtPath, &o.KeyPath
	case *v1.HTTPS2HTTPSPluginOptions:
		return &o.CrtPath, &o.KeyPath
	case *v1.TLS2RawPluginOptions:
		return &o.CrtPath, &o.KeyPath
	}
	return nil, nil
}

func isPEM(s string) bool {
	return strings.Contains(s, "-----BEGIN")
}

// writePluginCerts writes PEM contents pasted into a plugin's crtPath/keyPath to
// <data>/frpc/<server>/plugin-certs and points the plugin at the files. Values that
// are already paths are left alone, so a path on the Podux host also works.
func (fs *Service) writePluginCerts(serverID string, cfgs []v1.ProxyConfigurer) error {
	dir := filepath.Join(fs.getFrpMainPath(&serverID), "plugin-certs")
	for _, cfg := range cfgs {
		crt, key := pluginCertFields(cfg)
		if crt == nil {
			continue
		}
		name := cfg.GetBaseConfig().Name
		for _, f := range []struct {
			value *string
			ext   string
			mode  os.FileMode
		}{{crt, ".crt", 0o644}, {key, ".key", 0o600}} {
			if !isPEM(*f.value) {
				continue
			}
			if err := os.MkdirAll(dir, 0o700); err != nil {
				return err
			}
			path := filepath.Join(dir, name+f.ext)
			if err := os.WriteFile(path, []byte(*f.value), f.mode); err != nil {
				return err
			}
			*f.value = path
		}
	}
	return nil
}

// exportPluginCerts replaces pasted plugin certificates with paths under certs/ for
// an exported frpc.toml and returns those paths, which the user must provide.
func exportPluginCerts(cfgs []v1.ProxyConfigurer) []string {
	var files []string
	for _, cfg := range cfgs {
		crt, key := pluginCertFields(cfg)
		if crt == nil {
			continue
		}
		name := cfg.GetBaseConfig().Name
		for _, f := range []struct {
			value *string
			ext   string
		}{{crt, ".crt"}, {key, ".key"}} {
			if isPEM(*f.value) {
				*f.value = "certs/" + name + f.ext
				files = append(files, *f.value)
			}
		}
	}
	return files
}
