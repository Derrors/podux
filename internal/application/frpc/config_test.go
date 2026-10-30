package frpc

import (
	"testing"

	"podux/internal/infrastructure/persistence"
	"podux/internal/testutil"

	v1 "github.com/fatedier/frp/pkg/config/v1"
	"github.com/fatedier/frp/pkg/config/v1/validation"
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
	fs := NewService(app, persistence.NewServerRepository(app), persistence.NewProxyRepository(app), persistence.NewVisitorRepository(app))

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
	fs := NewService(app, persistence.NewServerRepository(app), persistence.NewProxyRepository(app), persistence.NewVisitorRepository(app))

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

func TestGenProxyCfgsSecretTypesAndHealthCheck(t *testing.T) {
	app := testutil.NewApp(t)
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "s", "serverAddr": "127.0.0.1", "serverPort": 7000, "bootStatus": "stopped",
	})
	stcp := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "nas", "proxyType": "stcp", "serverId": server.Id, "localIP": "127.0.0.1", "localPort": "22",
		"remotePort": "6000", "status": "enabled", "bootStatus": "offline",
		"secretKey": "k", "allowUsers": []string{"*"},
	})
	web := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "web", "proxyType": "tcp", "serverId": server.Id, "localIP": "127.0.0.1", "localPort": "80",
		"remotePort": "6080", "status": "enabled", "bootStatus": "offline", "secretKey": "ignored",
		"transport":   map[string]any{"bandwidthLimit": "2MB", "bandwidthLimitMode": "server"},
		"healthCheck": map[string]any{"type": "http", "path": "/health", "intervalSeconds": 15, "maxFailed": 3},
	})
	testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "off", "proxyType": "tcp", "serverId": server.Id, "localPort": "81",
		"remotePort": "6081", "status": "enabled", "bootStatus": "offline",
		"healthCheck": map[string]any{"type": "", "intervalSeconds": 10},
	})
	fs := NewService(app, persistence.NewServerRepository(app), persistence.NewProxyRepository(app), persistence.NewVisitorRepository(app))

	cfgs, err := fs.genProxyCfgs(&server.Id)
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]v1.ProxyConfigurer{}
	for _, c := range cfgs {
		c.Complete()
		if err := validation.ValidateProxyConfigurerForClient(c); err != nil {
			t.Errorf("%s fails frp validation: %v", c.GetBaseConfig().Name, err)
		}
		byName[c.GetBaseConfig().Name] = c
	}

	s, ok := byName["nas-"+stcp.Id].(*v1.STCPProxyConfig)
	if !ok {
		t.Fatalf("stcp proxy missing or wrong type: %T", byName["nas-"+stcp.Id])
	}
	if s.Secretkey != "k" || len(s.AllowUsers) != 1 || s.AllowUsers[0] != "*" {
		t.Errorf("stcp secret/allowUsers = %q/%v", s.Secretkey, s.AllowUsers)
	}

	w, ok := byName["web-"+web.Id].(*v1.TCPProxyConfig)
	if !ok {
		t.Fatalf("tcp proxy missing or wrong type")
	}
	if w.HealthCheck.Type != "http" || w.HealthCheck.Path != "/health" || w.HealthCheck.MaxFailed != 3 {
		t.Errorf("health check = %+v", w.HealthCheck)
	}
	if w.Transport.BandwidthLimit.String() != "2MB" || w.Transport.BandwidthLimitMode != "server" {
		t.Errorf("bandwidth = %s/%s", w.Transport.BandwidthLimit.String(), w.Transport.BandwidthLimitMode)
	}
}

func TestGenVisitorCfgs(t *testing.T) {
	app := testutil.NewApp(t)
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "s", "serverAddr": "127.0.0.1", "serverPort": 7000, "bootStatus": "stopped",
	})
	x := testutil.SaveRecord(t, app, "fh_visitors", map[string]any{
		"name": "nas", "visitorType": "xtcp", "serverId": server.Id, "serverName": "nas-abc",
		"serverUser": "home", "secretKey": "k", "bindPort": 6000, "keepTunnelOpen": true,
		"transport": map[string]any{"useEncryption": true}, "status": "enabled",
	})
	testutil.SaveRecord(t, app, "fh_visitors", map[string]any{
		"name": "off", "visitorType": "stcp", "serverId": server.Id, "serverName": "x",
		"bindPort": 6001, "status": "disabled",
	})
	fs := NewService(app, persistence.NewServerRepository(app), persistence.NewProxyRepository(app), persistence.NewVisitorRepository(app))

	cfgs, err := fs.genVisitorCfgs(&server.Id)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfgs) != 1 {
		t.Fatalf("got %d visitors, want only the enabled one", len(cfgs))
	}
	cfgs[0].Complete()
	if err := validation.ValidateVisitorConfigurer(cfgs[0]); err != nil {
		t.Errorf("visitor fails frp validation: %v", err)
	}
	v, ok := cfgs[0].(*v1.XTCPVisitorConfig)
	if !ok {
		t.Fatalf("visitor type %T, want xtcp", cfgs[0])
	}
	if v.Name != "nas-"+x.Id || v.ServerName != "nas-abc" || v.ServerUser != "home" || v.SecretKey != "k" ||
		v.BindAddr != "127.0.0.1" || v.BindPort != 6000 || !v.KeepTunnelOpen || !v.Transport.UseEncryption {
		t.Errorf("visitor = %+v", v.VisitorBaseConfig)
	}
}
