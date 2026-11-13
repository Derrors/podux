package monitoring

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"podux/internal/testutil"
)

func TestFrpsRefreshNonBlockingDeduplicatedAndCancellation(t *testing.T) {
	app := newTestApp(t)
	started := make(chan struct{}, 8)
	release := make(chan struct{})
	var calls atomic.Int32
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		started <- struct{}{}
		select {
		case <-release:
			_, _ = w.Write([]byte(`{"vhostHTTPPort":18080,"totalTrafficIn":42}`))
		case <-r.Context().Done():
		}
	}))
	defer remote.Close()
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "slow", "serverAddr": "127.0.0.1", "serverPort": 7000, "dashboard": DashboardConfig{URL: remote.URL}})
	s := NewFrpsService(app)
	defer s.Stop()
	ctx, cancel := context.WithCancel(context.Background())
	before := time.Now()
	cold, err := s.ServerStats(ctx, server.Id)
	if err != nil || cold == nil || cold.Info != nil || time.Since(before) > time.Second {
		t.Fatalf("cold lookup blocked or invalid: %+v %v", cold, err)
	}
	awaitProbeSignal(t, started)
	cancel()
	for range 20 {
		if _, err := s.ServerStats(context.Background(), server.Id); err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("duplicate dashboard requests: %d", calls.Load())
	}
	close(release)
	waitCtx, stop := context.WithTimeout(context.Background(), 3*time.Second)
	defer stop()
	ready, err := s.ReadyStats(waitCtx, server.Id)
	if err != nil || ready.Info == nil || ready.Info.VhostHTTPPort != 18080 || ready.Error != "" || ready.Fetched.IsZero() {
		t.Fatalf("request cancellation poisoned refresh: %+v %v", ready, err)
	}
	// Mutating a caller's returned snapshot must not affect the cached value.
	ready.Info.VhostHTTPPort = 1
	again, _ := s.ServerStats(context.Background(), server.Id)
	if again.Info.VhostHTTPPort != 18080 {
		t.Fatal("caller mutated cached snapshot")
	}
}
func TestFrpsRefreshKeepsSnapshotOnFailureAndStop(t *testing.T) {
	app := newTestApp(t)
	var fail atomic.Bool
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail.Load() {
			w.WriteHeader(503)
			return
		}
		_, _ = w.Write([]byte(`{"vhostHTTPPort":8088,"totalTrafficIn":13}`))
	}))
	defer remote.Close()
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "old", "serverAddr": "127.0.0.1", "serverPort": 7000, "dashboard": DashboardConfig{URL: remote.URL}})
	s := NewFrpsService(app)
	defer s.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	good, err := s.ReadyStats(ctx, server.Id)
	if err != nil {
		t.Fatal(err)
	}
	fail.Store(true)
	s.mu.Lock()
	s.cache[server.Id].stats.LastAttempt = time.Time{}
	s.mu.Unlock()
	old, _ := s.ServerStats(ctx, server.Id)
	if old.Info == nil || old.Info.TotalTrafficIn != 13 {
		t.Fatal("stale snapshot disappeared during refresh")
	}
	waitFor(t, func() bool { st, _ := s.ServerStats(ctx, server.Id); return st != nil && st.Error != "" })
	failed, _ := s.ServerStats(ctx, server.Id)
	if failed.Info == nil || !failed.Fetched.Equal(good.Fetched) || failed.RefreshState != "idle" {
		t.Fatalf("failure replaced successful snapshot: %+v", failed)
	}
	s.Stop()
	stopped, _ := s.ServerStats(context.Background(), server.Id)
	if stopped.Info == nil || stopped.RefreshState != "stopped" {
		t.Fatalf("stopped snapshot: %+v", stopped)
	}
}
func TestFrpsConfigurationChangeAndDeletionFenceLateResults(t *testing.T) {
	app := newTestApp(t)
	started := make(chan struct{}, 1)
	old := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { started <- struct{}{}; <-r.Context().Done() }))
	defer old.Close()
	fresh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"vhostHTTPPort":9080}`)) }))
	defer fresh.Close()
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "change", "serverAddr": "127.0.0.1", "serverPort": 7000, "dashboard": DashboardConfig{URL: old.URL}})
	s := NewFrpsService(app)
	s.RegisterHooks()
	defer s.Stop()
	_, _ = s.ServerStats(context.Background(), server.Id)
	awaitProbeSignal(t, started)
	server.Set("dashboard", DashboardConfig{URL: fresh.URL})
	if err := app.Save(server); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	st, err := s.ReadyStats(ctx, server.Id)
	if err != nil || st.Info == nil || st.Info.VhostHTTPPort != 9080 {
		t.Fatalf("new configuration not respected: %+v %v", st, err)
	}
	if err := app.Delete(server); err != nil {
		t.Fatal(err)
	}
	if st, err := s.ServerStats(context.Background(), server.Id); err == nil || st != nil {
		t.Fatalf("deleted server returned: %+v %v", st, err)
	}
	s.Stop()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cache[server.Id] != nil {
		t.Fatal("deleted server revived after Stop")
	}
}
func waitFor(t *testing.T, fn func() bool) {
	t.Helper()
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	for !fn() {
		select {
		case <-deadline.C:
			t.Fatal("timed out")
		case <-tick.C:
		}
	}
}
func TestProbeColdDashboardUsesReportedPorts(t *testing.T) {
	app := newTestApp(t)
	dash := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/serverinfo" {
			_, _ = w.Write([]byte(`{"vhostHTTPPort":18081,"subdomainHost":"example.test"}`))
		} else {
			_, _ = w.Write([]byte(`{"proxies":[]}`))
		}
	}))
	defer dash.Close()
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "ports", "serverAddr": "127.0.0.1", "serverPort": 7000, "dashboard": DashboardConfig{URL: dash.URL}})
	testutil.SaveRecord(t, app, "fh_proxies", map[string]any{"name": "web", "serverId": server.Id, "proxyType": "http", "status": "enabled", "bootStatus": "online", "subdomain": "app"})
	frps := NewFrpsService(app)
	defer frps.Stop()
	s := NewProbeService(app, frps)
	defer s.Stop()
	targets := s.targets(context.Background(), server)
	if len(targets) != 1 || targets[0].endpoint != "app.example.test:18081" {
		t.Fatalf("cold dashboard used default ports: %+v", targets)
	}
}

func TestProbePublicHTTPSUsesDomainPort443(t *testing.T) {
	app := newTestApp(t)
	dash := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/serverinfo" {
			_, _ = w.Write([]byte(`{"vhostHTTPPort":18081,"vhostHTTPSPort":18443,"subdomainHost":"example.test"}`))
		} else {
			_, _ = w.Write([]byte(`{"proxies":[]}`))
		}
	}))
	defer dash.Close()
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "public", "serverAddr": "127.0.0.1", "serverPort": 7000,
		"dashboard": DashboardConfig{URL: dash.URL}, "probePublicHTTPS": true,
	})
	online := func(fields map[string]any) {
		fields["serverId"], fields["status"], fields["bootStatus"] = server.Id, "enabled", "online"
		testutil.SaveRecord(t, app, "fh_proxies", fields)
	}
	online(map[string]any{"name": "web", "proxyType": "http", "subdomain": "app"})
	online(map[string]any{"name": "secure", "proxyType": "https", "customDomains": []string{"secure.example.test"}})
	online(map[string]any{"name": "ssh", "proxyType": "tcp", "localPort": 22, "remotePort": 6022})
	frps := NewFrpsService(app)
	defer frps.Stop()
	s := NewProbeService(app, frps)
	defer s.Stop()

	got := map[string]probeTarget{}
	for _, target := range s.targets(context.Background(), server) {
		got[target.name] = target
	}
	if w := got["web"]; w.endpoint != "app.example.test:443" || w.scheme != "https" || w.host != "app.example.test" {
		t.Errorf("http proxy not probed through public https: %+v", w)
	}
	if w := got["secure"]; w.endpoint != "secure.example.test:443" || w.scheme != "" {
		t.Errorf("https proxy not probed on 443: %+v", w)
	}
	if w := got["ssh"]; w.endpoint != "127.0.0.1:6022" {
		t.Errorf("tcp proxy endpoint changed: %+v", w)
	}

	server.Set("probePublicHTTPS", false)
	if err := app.Save(server); err != nil {
		t.Fatal(err)
	}
	for _, target := range s.targets(context.Background(), server) {
		if target.name == "web" && (target.endpoint != "app.example.test:18081" || target.scheme != "") {
			t.Errorf("switching off did not restore frps vhost probes: %+v", target)
		}
	}
}
