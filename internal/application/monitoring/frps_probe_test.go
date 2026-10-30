package monitoring

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"podux/internal/testutil"
)

// fakeDashboard serves the frps dashboard API for one tcp proxy named frpsName.
func fakeDashboard(t *testing.T, frpsName string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u, p, ok := r.BasicAuth(); !ok || u != "admin" || p != "pw" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var body any
		switch r.URL.Path {
		case "/api/serverinfo":
			body = map[string]any{"version": "0.71.1", "vhostHTTPPort": 8080, "subdomainHost": "example.com", "totalTrafficIn": 100}
		case "/api/proxy/tcp":
			body = map[string]any{"proxies": []map[string]any{
				{"name": frpsName, "todayTrafficIn": 10, "todayTrafficOut": 20, "curConns": 2, "status": "online"},
				{"name": "someone-else", "todayTrafficIn": 99},
			}}
		case "/api/traffic/" + frpsName:
			body = map[string]any{"name": frpsName, "trafficIn": []int64{1, 2, 3, 4, 5, 6, 7}, "trafficOut": []int64{7, 6, 5, 4, 3, 2, 1}}
		default:
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
}

func TestFrpsStats(t *testing.T) {
	app := testutil.NewApp(t)
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "s", "serverAddr": "127.0.0.1", "serverPort": 7000, "user": "home"})
	proxy := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "ssh", "proxyType": "tcp", "serverId": server.Id, "localPort": 22, "remotePort": 6022, "status": "enabled", "bootStatus": "online",
	})
	dash := fakeDashboard(t, "home.ssh-"+proxy.Id)
	defer dash.Close()
	s := NewFrpsService(app)

	if stats, err := s.ServerStats(context.Background(), server.Id); err != nil || stats != nil {
		t.Fatalf("no dashboard configured: %+v %v", stats, err)
	}

	server.Set("dashboard", map[string]any{"url": dash.URL, "user": "admin", "password": "wrong"})
	if err := app.Save(server); err != nil {
		t.Fatal(err)
	}
	if _, err := s.TestDashboard(context.Background(), DashboardConfig{URL: dash.URL, User: "admin", Password: "wrong"}); err == nil || !strings.Contains(err.Error(), "401") {
		t.Errorf("bad login: %v", err)
	}

	server.Set("dashboard", map[string]any{"url": dash.URL + "/", "user": "admin", "password": "pw"})
	if err := app.Save(server); err != nil {
		t.Fatal(err)
	}
	stats, err := s.ServerStats(context.Background(), server.Id)
	if err != nil || stats.Error != "" || stats.Info.VhostHTTPPort != 8080 {
		t.Fatalf("stats = %+v, %v", stats, err)
	}
	if got := stats.Proxies[proxy.Id]; got.TodayTrafficIn != 10 || got.TodayTrafficOut != 20 || got.CurConns != 2 {
		t.Errorf("proxy traffic = %+v", got)
	}
	if len(stats.Proxies) != 1 {
		t.Errorf("stats include foreign proxies: %+v", stats.Proxies)
	}

	h, err := s.ProxyHistory(context.Background(), proxy.Id)
	if err != nil || len(h.TrafficIn) != 7 || h.TrafficOut[0] != 7 {
		t.Fatalf("history = %+v, %v", h, err)
	}
}

func TestProbe(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()
	defer ln.Close()

	app200 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != "app.example.com" || r.URL.Path != "/api" {
			t.Errorf("probe sent Host %q path %q", r.Host, r.URL.Path)
		}
		w.WriteHeader(http.StatusUnauthorized) // e.g. httpUser set: still reachable
	}))
	defer app200.Close()
	frps404 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("<p><em>" + frpsNotFoundMarker + "</em></p>"))
	}))
	defer frps404.Close()
	tlsSrv := httptest.NewTLSServer(http.NotFoundHandler())
	defer tlsSrv.Close()

	ctx := context.Background()
	hostOf := func(u string) string { return strings.TrimPrefix(strings.TrimPrefix(u, "http://"), "https://") }
	cases := []struct {
		name string
		t    probeTarget
		ok   bool
	}{
		{"tcp open", probeTarget{proxyType: "tcp", endpoint: ln.Addr().String()}, true},
		{"tcp closed", probeTarget{proxyType: "tcp", endpoint: "127.0.0.1:1"}, false},
		{"http answered", probeTarget{proxyType: "http", endpoint: hostOf(app200.URL), host: "app.example.com", path: "/api"}, true},
		{"http frps 404", probeTarget{proxyType: "http", endpoint: hostOf(frps404.URL), host: "x", path: "/"}, false},
		{"https handshake", probeTarget{proxyType: "https", endpoint: hostOf(tlsSrv.URL), host: "x.example.com"}, true},
	}
	for _, c := range cases {
		if err := probe(ctx, c.t); (err == nil) != c.ok {
			t.Errorf("%s: err = %v, want ok=%v", c.name, err, c.ok)
		}
	}

	if got := probeHost([]string{"*.example.com", "b.example.com"}, "sub", "example.org"); got != "b.example.com" {
		t.Errorf("probeHost = %q", got)
	}
	if got := probeHost(nil, "sub", "example.org"); got != "sub.example.org" {
		t.Errorf("probeHost subdomain = %q", got)
	}
}
