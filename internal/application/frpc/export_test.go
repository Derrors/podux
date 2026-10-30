package frpc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"podux/internal/infrastructure/persistence"
	"podux/internal/testutil"

	"github.com/fatedier/frp/pkg/config"
	"github.com/fatedier/frp/pkg/config/v1/validation"
)

func TestExportTomlLoadsInFrpc(t *testing.T) {
	app := testutil.NewApp(t)
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "s", "serverAddr": "frps.example.com", "serverPort": 7000, "user": "home",
		"auth":      map[string]any{"method": "token", "token": "tok-secret"},
		"transport": map[string]any{"protocol": "tcp", "tls": map[string]any{"enable": true, "trustedCaFile": "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----"}},
		"log":       map[string]any{"level": "debug", "maxDays": 5},
	})
	ssh := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "ssh", "proxyType": "tcp", "serverId": server.Id, "localIP": "127.0.0.1", "localPort": "22",
		"remotePort": "6022", "status": "enabled", "bootStatus": "offline",
		"transport":   map[string]any{"useEncryption": true, "bandwidthLimit": "1MB"},
		"healthCheck": map[string]any{"type": "tcp", "intervalSeconds": 10},
	})
	testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "nas", "proxyType": "stcp", "serverId": server.Id, "localIP": "127.0.0.1", "localPort": "5000",
		"status": "enabled", "bootStatus": "offline", "secretKey": "stcp-secret",
	})
	testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "off", "proxyType": "tcp", "serverId": server.Id, "localPort": "80", "remotePort": "6080",
		"status": "disabled", "bootStatus": "offline",
	})
	testutil.SaveRecord(t, app, "fh_visitors", map[string]any{
		"name": "office", "visitorType": "xtcp", "serverId": server.Id, "serverName": "desk",
		"secretKey": "visitor-secret", "bindPort": 6000, "status": "enabled",
	})
	fs := NewService(app, persistence.NewServerRepository(app), persistence.NewProxyRepository(app), persistence.NewVisitorRepository(app))

	for _, includeSecrets := range []bool{false, true} {
		out, err := fs.ExportToml(server.Id, includeSecrets)
		if err != nil {
			t.Fatal(err)
		}
		text := string(out)

		for _, secret := range []string{"tok-secret", "stcp-secret", "visitor-secret"} {
			if strings.Contains(text, secret) != includeSecrets {
				t.Errorf("includeSecrets=%v: %q present = %v", includeSecrets, secret, !includeSecrets)
			}
		}
		for _, want := range []string{"ssh-" + ssh.Id, `trustedCaFile = 'certs/ca.pem'`, "serverPort = 7000", "certs/ca.pem"} {
			if !strings.Contains(text, want) {
				t.Errorf("export lacks %q:\n%s", want, text)
			}
		}
		if strings.Contains(text, "BEGIN CERTIFICATE") || strings.Contains(text, "off-") ||
			strings.Count(text, "[proxies.healthCheck]") != 1 || strings.Contains(text, "= 0\n") {
			t.Errorf("export has certificate contents, a disabled proxy, an empty health check or a zero value:\n%s", text)
		}

		// Strict loading rejects unknown keys, so this checks every exported key is frpc's.
		path := filepath.Join(t.TempDir(), "frpc.toml")
		if err := os.WriteFile(path, out, 0o600); err != nil {
			t.Fatal(err)
		}
		common, proxies, visitors, _, err := config.LoadClientConfig(path, true)
		if err != nil {
			t.Fatalf("frpc cannot load the export: %v\n%s", err, text)
		}
		if _, err := validation.ValidateAllClientConfig(common, proxies, visitors, nil); err != nil {
			t.Fatalf("export fails frpc validation: %v\n%s", err, text)
		}
		if len(proxies) != 2 || len(visitors) != 1 || common.User != "home" || common.Log.Level != "debug" {
			t.Fatalf("loaded %d proxies, %d visitors, user %q, log %q", len(proxies), len(visitors), common.User, common.Log.Level)
		}
		if includeSecrets && common.Auth.Token != "tok-secret" {
			t.Errorf("token = %q", common.Auth.Token)
		}
	}
}
