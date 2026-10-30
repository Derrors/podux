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
type = "tcpmux"
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
