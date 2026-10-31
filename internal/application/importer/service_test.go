package importer

import (
	"slices"
	"strings"
	"testing"

	"podux/internal/testutil"

	"github.com/pelletier/go-toml/v2"
)

func parseTransport(t *testing.T, src string) tomlTransportConfig {
	t.Helper()
	var cfg tomlFrpClientConfig
	if err := toml.Unmarshal([]byte(src), &cfg); err != nil {
		t.Fatal(err)
	}
	return cfg.Transport
}

func TestBuildTransportMapTLSDefaults(t *testing.T) {
	m, warnings := buildTransportMap(parseTransport(t, `serverAddr = "1.2.3.4"`))
	tls := m["tls"].(map[string]interface{})
	if tls["enable"] != true {
		t.Fatalf("tls.enable = %v, want true (frp default)", tls["enable"])
	}
	if m["protocol"] != "tcp" {
		t.Fatalf("protocol = %v, want tcp", m["protocol"])
	}
	if len(warnings) != 0 {
		t.Fatalf("unexpected warnings %v", warnings)
	}

	m, _ = buildTransportMap(parseTransport(t, "[transport.tls]\nenable = false\n"))
	if m["tls"].(map[string]interface{})["enable"] != false {
		t.Fatal("explicit tls.enable = false not kept")
	}
}

func TestBuildTransportMapDropsCertPaths(t *testing.T) {
	src := `
[transport.tls]
certFile = "/etc/frp/client.crt"
keyFile = "/etc/frp/client.key"
trustedCaFile = """-----BEGIN CERTIFICATE-----
abc
-----END CERTIFICATE-----"""
`
	m, warnings := buildTransportMap(parseTransport(t, src))
	tls := m["tls"].(map[string]interface{})
	if tls["certFile"] != "" || tls["keyFile"] != "" {
		t.Fatalf("file paths were kept: cert=%q key=%q", tls["certFile"], tls["keyFile"])
	}
	if tls["trustedCaFile"] == "" {
		t.Fatal("inline PEM content was dropped")
	}
	if len(warnings) != 1 || warnings[0] != WarningTLSFilePathIgnored {
		t.Fatalf("warnings = %v, want [%s]", warnings, WarningTLSFilePathIgnored)
	}
}

const secretTypesToml = `
serverAddr = "frps.example.com"
serverPort = 7000

[[proxies]]
name = "ssh"
localPort = 22
remotePort = 6022
transport.bandwidthLimit = "1MB"
healthCheck.type = "tcp"
healthCheck.intervalSeconds = 10

[[proxies]]
name = "nas"
type = "stcp"
localPort = 5000
secretKey = "k"
allowUsers = ["*"]

[[proxies]]
name = "mux"
type = "ftp"
localPort = 80

[[visitors]]
name = "office"
type = "xtcp"
serverName = "office-desktop"
secretKey = "k2"
bindPort = 6000
keepTunnelOpen = true

[[visitors]]
name = "untyped"
serverName = "x"
bindPort = 6001
`

func TestImportSecretTypesAndVisitors(t *testing.T) {
	app := testutil.NewApp(t)
	s := NewService(app)

	preview, err := s.ParseToml(&ParseTomlRequest{TomlContent: secretTypesToml})
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.Proxies) != 2 || len(preview.Visitors) != 1 {
		t.Fatalf("preview has %d proxies and %d visitors, want 2 and 1", len(preview.Proxies), len(preview.Visitors))
	}
	for _, w := range []string{WarningUnsupportedProxySkipped, WarningUnsupportedVisitorSkipped} {
		if !slices.Contains(preview.Warnings, w) {
			t.Errorf("warnings %v missing %s", preview.Warnings, w)
		}
	}

	req := &ExecuteImportRequest{
		TomlContent: secretTypesToml, ImportServer: true, ImportVisitors: true,
		Proxies: []ProxyImportOption{{Name: "ssh", Import: true}, {Name: "nas", Import: true}},
	}
	result, err := s.ExecuteImport(req)
	if err != nil {
		t.Fatal(err)
	}
	if result.ProxiesImported != 2 || result.VisitorsImported != 1 || result.VisitorsSkipped != 1 {
		t.Fatalf("result = %+v", result)
	}

	nas, err := app.FindFirstRecordByData("fh_proxies", "name", "nas")
	if err != nil {
		t.Fatal(err)
	}
	if nas.GetString("proxyType") != "stcp" || nas.GetString("secretKey") != "k" {
		t.Errorf("stcp proxy = %v", nas.PublicExport())
	}
	ssh, err := app.FindFirstRecordByData("fh_proxies", "name", "ssh")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(ssh.GetString("healthCheck"), `"tcp"`) || !strings.Contains(ssh.GetString("transport"), "1MB") {
		t.Errorf("ssh healthCheck/transport = %s / %s", ssh.GetString("healthCheck"), ssh.GetString("transport"))
	}
	office, err := app.FindFirstRecordByData("fh_visitors", "name", "office")
	if err != nil {
		t.Fatal(err)
	}
	if office.GetString("visitorType") != "xtcp" || office.GetInt("bindPort") != 6000 ||
		!office.GetBool("keepTunnelOpen") || office.GetString("status") != "enabled" {
		t.Errorf("visitor = %v", office.PublicExport())
	}

	// A second import sees the visitor as a duplicate and skips it unless overwriting.
	preview, err = s.ParseToml(&ParseTomlRequest{TomlContent: secretTypesToml})
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Visitors[0].IsDuplicate {
		t.Error("existing visitor not flagged as duplicate")
	}
	req.ImportServer = false
	req.Proxies = nil
	result, err = s.ExecuteImport(req)
	if err != nil {
		t.Fatal(err)
	}
	if result.VisitorsImported != 0 || result.VisitorsSkipped != 2 {
		t.Errorf("re-import result = %+v", result)
	}
}

const optionsToml = `
serverAddr = "frps2.example.com"

[[proxies]]
name = "web"
type = "http"
localPort = 80
customDomains = ["a.example.com"]
locations = ["/api"]
httpUser = "u"
httpPassword = "p"
hostHeaderRewrite = "internal"
requestHeaders.set.x-from = "podux"
loadBalancer.group = "web"
loadBalancer.groupKey = "k"

[[proxies]]
name = "mux"
type = "tcpmux"
multiplexer = "httpconnect"
customDomains = ["ssh.example.com"]
localPort = 22

[[proxies]]
name = "files"
type = "tcp"
remotePort = 6000
[proxies.plugin]
type = "static_file"
localPath = "/srv/files"
stripPrefix = "static"

[[visitors]]
name = "p2p"
type = "xtcp"
serverName = "nas"
bindPort = 6001
fallbackTo = "relay"
fallbackTimeoutMs = 500

[[visitors]]
name = "relay"
type = "stcp"
serverName = "nas"
bindPort = -1
`

func TestImportOptionsPluginsAndFallback(t *testing.T) {
	app := testutil.NewApp(t)
	s := NewService(app)

	preview, err := s.ParseToml(&ParseTomlRequest{TomlContent: optionsToml})
	if err != nil || len(preview.Proxies) != 3 || len(preview.Warnings) != 0 {
		t.Fatalf("preview = %+v, %v", preview, err)
	}
	_, err = s.ExecuteImport(&ExecuteImportRequest{
		TomlContent: optionsToml, ImportServer: true, ImportVisitors: true,
		Proxies: []ProxyImportOption{{Name: "web", Import: true}, {Name: "mux", Import: true}, {Name: "files", Import: true}},
	})
	if err != nil {
		t.Fatal(err)
	}

	web, _ := app.FindFirstRecordByData("fh_proxies", "name", "web")
	var opts map[string]any
	if err := web.UnmarshalJSONField("options", &opts); err != nil {
		t.Fatal(err)
	}
	lb, _ := opts["loadBalancer"].(map[string]any)
	if opts["httpUser"] != "u" || opts["hostHeaderRewrite"] != "internal" || lb["group"] != "web" || opts["locations"] == nil {
		t.Errorf("web options = %v", opts)
	}
	if mux, _ := app.FindFirstRecordByData("fh_proxies", "name", "mux"); mux.GetString("proxyType") != "tcpmux" {
		t.Errorf("tcpmux not imported: %v", mux)
	}
	files, _ := app.FindFirstRecordByData("fh_proxies", "name", "files")
	if !strings.Contains(files.GetString("plugin"), "static_file") || !strings.Contains(files.GetString("plugin"), "/srv/files") {
		t.Errorf("plugin = %s", files.GetString("plugin"))
	}

	p2p, _ := app.FindFirstRecordByData("fh_visitors", "name", "p2p")
	relay, _ := app.FindFirstRecordByData("fh_visitors", "name", "relay")
	if p2p.GetString("fallbackTo") != relay.Id || p2p.GetInt("fallbackTimeoutMs") != 500 {
		t.Errorf("fallback = %q/%d, want %q/500", p2p.GetString("fallbackTo"), p2p.GetInt("fallbackTimeoutMs"), relay.Id)
	}
}

func TestBuildAuthMapOIDC(t *testing.T) {
	var cfg tomlFrpClientConfig
	src := `
[auth]
method = "oidc"
additionalScopes = ["HeartBeats"]
[auth.oidc]
clientID = "cid"
clientSecret = "secret"
audience = "aud"
scope = "frp"
tokenEndpointURL = "https://idp.example.com/token"
trustedCaFile = "/etc/frp/idp-ca.pem"
insecureSkipVerify = true
[auth.oidc.additionalEndpointParams]
resource = "frps"
`
	if err := toml.Unmarshal([]byte(src), &cfg); err != nil {
		t.Fatal(err)
	}
	m, warnings := buildAuthMap(cfg.Auth)
	want := map[string]any{
		"method": "oidc", "oidcClientId": "cid", "oidcClientSecret": "secret", "oidcAudience": "aud",
		"oidcScope": "frp", "oidcTokenEndpoint": "https://idp.example.com/token", "oidcTrustedCa": "",
		"oidcInsecureSkipVerify": true,
	}
	for k, v := range want {
		if m[k] != v {
			t.Errorf("%s = %v, want %v", k, m[k], v)
		}
	}
	if p, _ := m["oidcAdditionalParams"].(map[string]string); p["resource"] != "frps" {
		t.Errorf("oidcAdditionalParams = %v", m["oidcAdditionalParams"])
	}
	if s, _ := m["additionalScopes"].([]string); !slices.Equal(s, []string{"HeartBeats"}) {
		t.Errorf("additionalScopes = %v", m["additionalScopes"])
	}
	// The CA was a path, which Podux cannot read.
	if !slices.Equal(warnings, []string{WarningTLSFilePathIgnored}) {
		t.Errorf("warnings = %v", warnings)
	}
}
