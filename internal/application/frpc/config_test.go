package frpc

import (
	"testing"

	"podux/internal/infrastructure/persistence"
	"podux/internal/testutil"

	v1 "github.com/fatedier/frp/pkg/config/v1"
)

func TestGenCommonCfgsMapsFlatOIDC(t *testing.T) {
	app := testutil.NewApp(t)
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "s", "serverAddr": "127.0.0.1", "serverPort": 7000, "bootStatus": "stopped",
		"auth": map[string]any{
			"method": "oidc", "oidcClientId": "cid", "oidcClientSecret": "secret",
			"oidcAudience": "aud", "oidcTokenEndpoint": "https://idp.example.com/token",
		},
		"transport": map[string]any{"tls": map[string]any{"enable": false}},
	})
	fs := NewService(app, persistence.NewServerRepository(app), persistence.NewProxyRepository(app))

	cfg, err := fs.genCommonCfgs(&server.Id)
	if err != nil {
		t.Fatal(err)
	}
	want := v1.AuthOIDCClientConfig{
		ClientID: "cid", ClientSecret: "secret", Audience: "aud",
		TokenEndpointURL: "https://idp.example.com/token",
	}
	if cfg.Auth.Method != "oidc" || cfg.Auth.OIDC.ClientID != want.ClientID ||
		cfg.Auth.OIDC.ClientSecret != want.ClientSecret || cfg.Auth.OIDC.Audience != want.Audience ||
		cfg.Auth.OIDC.TokenEndpointURL != want.TokenEndpointURL {
		t.Fatalf("auth = %+v, want method oidc with %+v", cfg.Auth, want)
	}
}

func TestGenProxyCfgsReadsLegacyTransportKeys(t *testing.T) {
	app := testutil.NewApp(t)
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "s", "serverAddr": "127.0.0.1", "serverPort": 7000, "bootStatus": "stopped",
	})
	for name, transport := range map[string]map[string]any{
		"legacy": {"use_encryption": true, "use_compression": true},
		"camel":  {"useEncryption": true, "useCompression": true, "bandwidthLimit": "1MB"},
	} {
		testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
			"name": name, "proxyType": "tcp", "serverId": server.Id, "localPort": "80",
			"remotePort": "6000", "status": "enabled", "bootStatus": "offline", "transport": transport,
		})
	}
	fs := NewService(app, persistence.NewServerRepository(app), persistence.NewProxyRepository(app))

	cfgs, err := fs.genProxyCfgs(&server.Id)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfgs) != 2 {
		t.Fatalf("got %d proxies, want 2", len(cfgs))
	}
	for _, c := range cfgs {
		base := c.GetBaseConfig()
		if !base.Transport.UseEncryption || !base.Transport.UseCompression {
			t.Errorf("%s: transport = %+v, want encryption and compression on", base.Name, base.Transport)
		}
	}
}
