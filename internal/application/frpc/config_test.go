package frpc

import (
	"os"
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

func TestGenProxyCfgsOptionsPluginsAndFallback(t *testing.T) {
	app := testutil.NewApp(t)
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "s", "serverAddr": "127.0.0.1", "serverPort": 7000, "bootStatus": "stopped",
	})
	pem := "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----"
	web := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "web", "proxyType": "http", "serverId": server.Id, "localPort": 80, "status": "enabled", "bootStatus": "offline",
		"customDomains": []string{"a.example.com"},
		"options": map[string]any{
			"httpUser": "u", "httpPassword": "p", "hostHeaderRewrite": "internal", "locations": []string{"/api"},
			"requestHeaders": map[string]any{"set": map[string]any{"X-From": "podux"}},
			"multiplexer":    "ignored for http", "loadBalancer": map[string]any{"group": "", "groupKey": ""},
		},
	})
	mux := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "mux", "proxyType": "tcpmux", "serverId": server.Id, "localPort": 22, "status": "enabled", "bootStatus": "offline",
		"customDomains": []string{"ssh.example.com"}, "options": map[string]any{"loadBalancer": map[string]any{"group": "g", "groupKey": "k"}},
	})
	tls := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "tls", "proxyType": "https", "serverId": server.Id, "status": "enabled", "bootStatus": "offline",
		"customDomains": []string{"b.example.com"},
		"plugin":        map[string]any{"type": "https2http", "localAddr": "127.0.0.1:80", "crtPath": pem, "keyPath": "/etc/key.pem"},
	})
	stcp := testutil.SaveRecord(t, app, "fh_visitors", map[string]any{
		"name": "fb", "visitorType": "stcp", "serverId": server.Id, "serverName": "nas", "bindPort": -1, "status": "enabled",
	})
	xtcp := testutil.SaveRecord(t, app, "fh_visitors", map[string]any{
		"name": "p2p", "visitorType": "xtcp", "serverId": server.Id, "serverName": "nas", "bindPort": 6000, "status": "enabled",
		"fallbackTo": stcp.Id, "fallbackTimeoutMs": 800,
	})
	fs := NewService(app, persistence.NewServerRepository(app), persistence.NewProxyRepository(app), persistence.NewVisitorRepository(app))

	proxies, err := fs.genProxyCfgs(&server.Id)
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]v1.ProxyConfigurer{}
	for _, c := range proxies {
		c.Complete()
		if err := validation.ValidateProxyConfigurerForClient(c); err != nil {
			t.Errorf("%s fails frp validation: %v", c.GetBaseConfig().Name, err)
		}
		byName[c.GetBaseConfig().Name] = c
	}

	h := byName["web-"+web.Id].(*v1.HTTPProxyConfig)
	if h.HTTPUser != "u" || h.HTTPPassword != "p" || h.HostHeaderRewrite != "internal" ||
		len(h.Locations) != 1 || h.RequestHeaders.Set["X-From"] != "podux" || h.LoadBalancer.Group != "" {
		t.Errorf("http options = %+v", h)
	}
	m := byName["mux-"+mux.Id].(*v1.TCPMuxProxyConfig)
	if m.Multiplexer != "httpconnect" || m.LoadBalancer.Group != "g" || m.LoadBalancer.GroupKey != "k" {
		t.Errorf("tcpmux = %+v", m)
	}

	if err := fs.writePluginCerts(server.Id, proxies); err != nil {
		t.Fatal(err)
	}
	opts := byName["tls-"+tls.Id].GetBaseConfig().Plugin.ClientPluginOptions.(*v1.HTTPS2HTTPPluginOptions)
	if data, err := os.ReadFile(opts.CrtPath); err != nil || string(data) != pem {
		t.Errorf("pasted certificate not written to a file: %q (%v)", opts.CrtPath, err)
	}
	if opts.KeyPath != "/etc/key.pem" {
		t.Errorf("a key path must be kept as is, got %q", opts.KeyPath)
	}

	visitors, err := fs.genVisitorCfgs(&server.Id)
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range visitors {
		if v.GetBaseConfig().Name != "p2p-"+xtcp.Id {
			continue
		}
		x := v.(*v1.XTCPVisitorConfig)
		if x.FallbackTo != "fb-"+stcp.Id || x.FallbackTimeoutMs != 800 {
			t.Errorf("fallback = %q/%d", x.FallbackTo, x.FallbackTimeoutMs)
		}
	}
}
