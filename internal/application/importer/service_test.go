package importer

import (
	"testing"

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
