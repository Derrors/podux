package monitoring

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"podux/internal/testutil"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Each API edit loads a fresh record; Original is not refreshed by app.Save.
func setProbeDisabled(t *testing.T, app core.App, id string, disabled bool) *core.Record {
	t.Helper()
	record, err := app.FindRecordById("fh_proxies", id)
	if err != nil {
		t.Fatal(err)
	}
	record.Set("probeDisabled", disabled)
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	return record
}

func TestProbeTargetsExcludeOptedOutProxy(t *testing.T) {
	app := testutil.NewApp(t)
	s := NewProbeService(app, NewFrpsService(app))
	defer s.Stop()
	s.RegisterProxyHooks(nil)
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "s", "serverAddr": "127.0.0.1", "serverPort": 7000, "bootStatus": "running",
	})
	ssh := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "ssh", "proxyType": "tcp", "serverId": server.Id, "localPort": 22, "remotePort": 6022,
		"status": "enabled", "bootStatus": "online", "probeDisabled": true,
	})
	web := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "web", "proxyType": "tcp", "serverId": server.Id, "localPort": 80, "remotePort": 6080,
		"status": "enabled", "bootStatus": "online",
	})
	if targets := s.targets(context.Background(), server); len(targets) != 1 || targets[0].id != web.Id {
		t.Fatalf("opted-out SSH should be the only skipped target: %+v", targets)
	}
	if ssh.GetString("status") != "enabled" || ssh.GetString("bootStatus") != "online" {
		t.Fatal("opting out disabled the tunnel")
	}
	setProbeDisabled(t, app, ssh.Id, false)
	if targets := s.targets(context.Background(), server); len(targets) != 2 {
		t.Fatalf("re-enabled proxy is missing: %+v", targets)
	}
}

func TestProbeOptOutCancelsInFlightAndResetsResults(t *testing.T) {
	app := testutil.NewApp(t)
	started, disconnected := make(chan struct{}, 1), make(chan struct{}, 1)
	var requests atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			started <- struct{}{}
			<-r.Context().Done()
			disconnected <- struct{}{}
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()
	s := NewProbeService(app, NewFrpsService(app))
	defer s.Stop()
	_, proxies := saveHTTPProbeServer(t, app, s, target.URL, 1)
	proxy := proxies[0]
	var forgotten atomic.Int32
	s.RegisterProxyHooks(func(id string) {
		if id != proxy.Id {
			t.Errorf("forgot wrong proxy %q", id)
		}
		forgotten.Add(1)
	})
	batches := make(chan []ProbeResult, 4)
	s.SetObserver(func(_, _ string, results []ProbeResult) { batches <- results })
	s.results[proxy.Id] = ProbeResult{ProxyID: proxy.Id, Reachable: false}
	done := make(chan struct{})
	go func() { defer close(done); s.ProbeAll(context.Background()) }()
	awaitProbeSignal(t, started)
	proxy = setProbeDisabled(t, app, proxy.Id, true)
	awaitProbeSignal(t, disconnected)
	awaitProbeSignal(t, done)
	if len(s.Results()) != 0 || forgotten.Load() != 1 || requests.Load() != 1 {
		t.Fatalf("opt-out did not clear/cancel the probe: results=%+v forgotten=%d requests=%d", s.Results(), forgotten.Load(), requests.Load())
	}
	if batch := <-batches; len(batch) != 0 {
		t.Fatalf("cancelled probe was sent to the alert observer: %+v", batch)
	}
	// The disabled record remains online and is not dialled on subsequent rounds.
	s.ProbeAll(context.Background())
	if requests.Load() != 1 || len(<-batches) != 0 {
		t.Fatal("disabled proxy was probed again")
	}
	if proxy.GetString("bootStatus") != "online" || proxy.GetString("status") != "enabled" {
		t.Fatal("opt-out changed frpc status")
	}

	// Even a stale cached entry must not produce a reachable=0/1 metric for an opt-out.
	s.mu.Lock()
	s.results[proxy.Id] = ProbeResult{ProxyID: proxy.Id, Reachable: true}
	s.mu.Unlock()
	var metrics bytes.Buffer
	exporter := NewExporter(app, NewMetricsService(app), s.frps, s)
	if err := exporter.Write(context.Background(), &metrics); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(metrics.String(), "podux_proxy_reachable") || !strings.Contains(metrics.String(), "podux_proxy_online") {
		t.Fatalf("opt-out metric suppression also lost tunnel status: %s", metrics.String())
	}

	proxy = setProbeDisabled(t, app, proxy.Id, false)
	if len(s.Results()) != 0 || forgotten.Load() != 2 {
		t.Fatal("re-enabling reused old probe state")
	}
	s.ProbeAll(context.Background())
	if result, ok := s.Results()[proxy.Id]; !ok || !result.Reachable || requests.Load() != 2 {
		t.Fatalf("re-enabled proxy was not probed: %+v, requests=%d", result, requests.Load())
	}
	if batch := <-batches; len(batch) != 1 || batch[0].ProxyID != proxy.Id {
		t.Fatalf("fresh result was not observed: %+v", batch)
	}
}

func TestProbeOptOutInvalidatesQueuedSnapshot(t *testing.T) {
	app := testutil.NewApp(t)
	var requests atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()
	s := NewProbeService(app, NewFrpsService(app))
	defer s.Stop()
	server, proxies := saveHTTPProbeServer(t, app, s, target.URL, 1)
	s.RegisterProxyHooks(nil)
	var observed []ProbeResult
	s.SetObserver(func(_, _ string, results []ProbeResult) { observed = results })
	// Capture a scheduled target, then turn it off and back on before dispatch.
	queued := s.targets(context.Background(), server)
	for _, disabled := range []bool{true, false} {
		setProbeDisabled(t, app, proxies[0].Id, disabled)
	}
	s.probeServer(context.Background(), server, queued)
	if requests.Load() != 0 || len(s.Results()) != 0 || len(observed) != 0 {
		t.Fatal("off/on revived a stale scheduled target")
	}
	s.ProbeAll(context.Background())
	if requests.Load() != 1 || len(s.Results()) != 1 || len(observed) != 1 {
		t.Fatal("a fresh round did not resume probing")
	}
}

func TestProbeOptOutClearsOnlyChangedProxy(t *testing.T) {
	app := testutil.NewApp(t)
	s := NewProbeService(app, NewFrpsService(app))
	defer s.Stop()
	_, proxies := saveHTTPProbeServer(t, app, s, "http://127.0.0.1:8080", 2)
	var forgotten []string
	s.RegisterProxyHooks(func(id string) { forgotten = append(forgotten, id) })
	for _, proxy := range proxies {
		s.results[proxy.Id] = ProbeResult{ProxyID: proxy.Id, Reachable: true}
	}
	setProbeDisabled(t, app, proxies[0].Id, true)
	if results := s.Results(); len(results) != 1 || results[proxies[1].Id].ProxyID == "" {
		t.Fatalf("opt-out cleared other proxy results: %+v", results)
	}
	// Unrelated edits must not erase results or reset alert counters.
	var err error
	proxies[1], err = app.FindRecordById("fh_proxies", proxies[1].Id)
	if err != nil {
		t.Fatal(err)
	}
	proxies[1].Set("description", "renamed description")
	if err := app.Save(proxies[1]); err != nil {
		t.Fatal(err)
	}
	if len(s.Results()) != 1 || len(forgotten) != 1 || forgotten[0] != proxies[0].Id {
		t.Fatal("unrelated edit cleared probe state")
	}
	if err := app.Delete(proxies[1]); err != nil {
		t.Fatal(err)
	}
	if len(s.Results()) != 0 || len(forgotten) != 2 || forgotten[1] != proxies[1].Id {
		t.Fatal("deleting proxy left probe results or alerts")
	}
}
