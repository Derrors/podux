package frpc

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"podux/internal/application/importer"
	"podux/internal/frpconfig"
	"podux/internal/infrastructure/persistence"
	"podux/internal/testutil"
)

func TestStructuredRedactionCoversNestedSecretsAndURLs(t *testing.T) {
	input := map[string]any{
		"httpPassword": "synthetic-http-value", "transport": map[string]any{"proxyURL": "http://demo:" + strings.Repeat("test", 3) + "@proxy.example.test:3128"},
		"headers": map[string]any{"Authorization": "synthetic-header-value"},
		"keyFile": strings.Join([]string{"-----BEGIN", "PRIVATE KEY-----\nSYNTHETIC-KEY", "-----END PRIVATE KEY-----"}, " "),
		"oidc":    map[string]any{"tokenEndpointURL": "https://example.test/token?client_secret=synthetic-query-value"},
		"nested":  []any{map[string]any{"HTTP_PASSWORD": "synthetic-escaped-\"-value"}},
	}
	safe, err := frpconfig.Plain(input, false)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(safe)
	for _, value := range []string{"synthetic-", "SYNTHETIC-KEY", "BEGIN PRIVATE KEY", "demo:"} {
		if strings.Contains(string(b), value) {
			t.Fatal("structured redactor leaked a test credential")
		}
	}
	if input["httpPassword"] != "synthetic-http-value" {
		t.Fatal("redaction mutated source")
	}
}

func TestDisabledTLSExportDropsResidualMaterial(t *testing.T) {
	app := testutil.NewApp(t)
	s := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "fixture", "serverAddr": "127.0.0.1", "serverPort": 7000,
		"transport": map[string]any{"tls": map[string]any{"enable": false, "certFile": "-----BEGIN CERTIFICATE-----\nSYNTHETIC-CERT", "keyFile": "-----BEGIN PRIVATE KEY-----\nSYNTHETIC-KEY", "trustedCaFile": "SYNTHETIC-CA"}},
	})
	fs := NewService(app, persistence.NewServerRepository(app), persistence.NewProxyRepository(app), persistence.NewVisitorRepository(app))
	for _, secrets := range []bool{false, true} {
		out, err := fs.ExportToml(s.Id, secrets)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(out), "SYNTHETIC-") || strings.Contains(string(out), "BEGIN") {
			t.Fatal("disabled TLS material leaked")
		}
	}
}

func TestImportedTokenOnlyConfigKeepsNativeDefault(t *testing.T) {
	app := testutil.NewApp(t)
	_, err := importer.NewService(app).ExecuteImport(&importer.ExecuteImportRequest{ImportServer: true, TomlContent: "serverAddr = '127.0.0.1'\nauth.token = 'synthetic-token-only'"})
	if err != nil {
		t.Fatal(err)
	}
	servers, err := app.FindAllRecords("fh_servers")
	if err != nil || len(servers) != 1 {
		t.Fatal("server not imported")
	}
	fs := NewService(app, persistence.NewServerRepository(app), persistence.NewProxyRepository(app), persistence.NewVisitorRepository(app))
	cfg, err := fs.buildCommonCfg(&servers[0].Id)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Auth.Method != "token" || cfg.Auth.Token != "synthetic-token-only" {
		t.Fatal("native token-only authentication lost")
	}
	if cfg.Transport.TLS.DisableCustomTLSFirstByte == nil || !*cfg.Transport.TLS.DisableCustomTLSFirstByte {
		t.Fatal("native TLS first-byte default lost")
	}
}

func TestPluginCertIdentityRotationAndPruning(t *testing.T) {
	app := testutil.NewApp(t)
	s := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "fixture", "serverAddr": "127.0.0.1", "serverPort": 7000})
	plugin := func(n int) map[string]any {
		return map[string]any{"type": "tls2raw", "localAddr": "127.0.0.1:8080", "crtPath": fmt.Sprintf("-----BEGIN CERTIFICATE-----\nSYNTHETIC-%d", n), "keyPath": "-----BEGIN PRIVATE KEY-----\nSYNTHETIC-KEY"}
	}
	p := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{"name": "../outside", "proxyType": "tcp", "serverId": s.Id, "remotePort": 6000, "status": "enabled", "bootStatus": "offline", "plugin": plugin(0)})
	fs := NewService(app, persistence.NewServerRepository(app), persistence.NewProxyRepository(app), persistence.NewVisitorRepository(app))
	var previous map[string]bool
	var prior any
	for n := 0; n < 5; n++ {
		p.Set("plugin", plugin(n))
		if err := app.Save(p); err != nil {
			t.Fatal(err)
		}
		cfgs, err := fs.genProxyCfgs(&s.Id)
		if err != nil {
			t.Fatal(err)
		}
		if err := fs.writePluginCerts(s.Id, cfgs); err != nil {
			t.Fatal(err)
		}
		crt, key := pluginCertFields(cfgs[0])
		if !strings.HasPrefix(filepath.Base(*crt), p.Id+"-") || filepath.Dir(*crt) != filepath.Join(fs.getFrpMainPath(&s.Id), "plugin-certs") {
			t.Fatal("editable name escaped certificate directory")
		}
		for _, path := range []string{*crt, *key} {
			info, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			if info.Mode().Perm() != 0o600 {
				t.Fatal("certificate permissions are not owner-only")
			}
		}
		if prior != nil && reflect.DeepEqual(prior, cfgs) {
			t.Fatal("PEM rotation is invisible to frp reload comparison")
		}
		files := pluginFiles(cfgs)
		if err := fs.prunePluginCerts(s.Id, files, previous); err != nil {
			t.Fatal(err)
		}
		previous, prior = files, cfgs
	}
	entries, err := os.ReadDir(filepath.Join(fs.getFrpMainPath(&s.Id), "plugin-certs"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) > 4 {
		t.Fatalf("old generations accumulate: %d files", len(entries))
	}
	out, err := fs.ExportToml(s.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(out), "certs/../") || !strings.Contains(string(out), "certs/"+p.Id+".crt") {
		t.Fatal("export used editable certificate filename")
	}
}

func TestCertificateDirectoriesRejectSymlinks(t *testing.T) {
	app := testutil.NewApp(t)
	fs := NewService(app, nil, nil, nil)
	outside := t.TempDir()
	base := filepath.Join(app.DataDir(), "frpc")
	if err := os.MkdirAll(base, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(base, serverA)); err != nil {
		t.Fatal(err)
	}
	if root, _, err := fs.certRoot(serverA, "plugin-certs"); err == nil {
		root.Close()
		t.Fatal("symlink directory accepted")
	}
	if root, _, err := fs.certRoot("../escape", "certs"); err == nil {
		root.Close()
		t.Fatal("invalid server ID accepted")
	}
}

func TestAtomicCertWriteReplacesSymlinkNotItsTarget(t *testing.T) {
	dir, outside := t.TempDir(), filepath.Join(t.TempDir(), "untouched")
	if err := os.WriteFile(outside, []byte("unchanged"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "key.pem")); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err := atomicCertWrite(root, "key.pem", "SYNTHETIC-REPLACEMENT"); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(outside)
	if err != nil || string(b) != "unchanged" {
		t.Fatal("atomic write followed the destination symlink")
	}
}
