package monitoring

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"podux/internal/testutil"
)

func TestProbeTargetsPacing(t *testing.T) {
	for _, tc := range []struct {
		name     string
		count    int
		duration time.Duration
		wantPeak int
	}{
		{"empty", 0, 0, 0},
		{"single", 1, 0, 1},
		{"spread over minute", 12, 0, 1},
		{"large round keeps minimum spacing", 300, 0, 1},
		{"slow probes stay bounded without catching up", 80, probeTimeout, probeConcurrency},
	} {
		t.Run(tc.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				targets := make([]probeTarget, tc.count)
				for i := range targets {
					targets[i].id = strconv.Itoa(i)
				}
				var mu sync.Mutex
				var starts []time.Time
				active, peak := 0, 0
				started := time.Now()
				probeTargets(context.Background(), targets, func(_ context.Context, i int, target probeTarget) {
					mu.Lock()
					starts = append(starts, time.Now())
					active++
					peak = max(peak, active)
					mu.Unlock()
					if target.id != strconv.Itoa(i) {
						t.Errorf("target %q assigned index %d", target.id, i)
					}
					time.Sleep(tc.duration)
					mu.Lock()
					active--
					mu.Unlock()
				})
				if len(starts) != tc.count || peak != tc.wantPeak || active != 0 {
					t.Fatalf("starts=%d peak=%d active=%d; want %d, %d, 0", len(starts), peak, active, tc.count, tc.wantPeak)
				}
				if tc.count == 0 {
					return
				}
				if !starts[0].Equal(started) {
					t.Errorf("first probe unnecessarily delayed by %v", starts[0].Sub(started))
				}
				spacing := max(probeMinSpacing, ProbeInterval/time.Duration(tc.count))
				for i := 1; i < len(starts); i++ {
					gap := starts[i].Sub(starts[i-1])
					if gap < spacing || (tc.duration == 0 && gap != spacing) {
						t.Errorf("probe %d gap=%v, want at least %v (exact for fast probes)", i, gap, spacing)
					}
				}
			})
		})
	}
}

func TestProbeTargetsCancellation(t *testing.T) {
	for _, tc := range []struct {
		name       string
		count      int
		elapsed    time.Duration
		block      bool
		preCancel  bool
		wantStarts int
	}{
		{"already cancelled", 2, 0, false, true, 0},
		{"waiting for next start", 2, 0, false, false, 1},
		{"waiting for a slot", 300, probeMinSpacing * probeConcurrency, true, false, probeConcurrency},
	} {
		t.Run(tc.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				if tc.preCancel {
					cancel()
				}
				var starts, active atomic.Int32
				done := make(chan struct{})
				go func() {
					defer close(done)
					probeTargets(ctx, make([]probeTarget, tc.count), func(ctx context.Context, _ int, _ probeTarget) {
						starts.Add(1)
						active.Add(1)
						defer active.Add(-1)
						if tc.block {
							<-ctx.Done()
						}
					})
				}()
				synctest.Wait()
				time.Sleep(tc.elapsed)
				synctest.Wait()
				if got := starts.Load(); got != int32(tc.wantStarts) {
					t.Fatalf("started %d probes before cancellation, want %d", got, tc.wantStarts)
				}
				cancel()
				synctest.Wait()
				select {
				case <-done:
				default:
					t.Fatal("cancellation did not drain probes immediately")
				}
				if starts.Load() != int32(tc.wantStarts) || active.Load() != 0 {
					t.Fatalf("after cancellation: starts=%d active=%d", starts.Load(), active.Load())
				}
			})
		})
	}
}

func TestProbeServiceLifecycle(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		// No app is needed: stopping during the initial wait must never start a round.
		s := NewProbeService(nil, nil)
		s.Start()
		s.Start()
		synctest.Wait()
		s.Stop()
		s.Stop()
		s.Start()
		time.Sleep(2 * ProbeInterval)
		synctest.Wait()

		s = NewProbeService(nil, nil)
		s.Stop()
		s.Start()
		time.Sleep(2 * ProbeInterval)
		synctest.Wait()
	})
}

// saveHTTPProbeServer makes real probe targets without depending on a dashboard.
func saveHTTPProbeServer(t *testing.T, app core.App, s *ProbeService, url string, count int) (*core.Record, []*core.Record) {
	t.Helper()
	addr, port, err := net.SplitHostPort(url[len("http://"):])
	if err != nil {
		t.Fatal(err)
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil {
		t.Fatal(err)
	}
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "probe", "serverAddr": addr, "serverPort": 7000, "bootStatus": "running",
	})
	cfg := DashboardConfig{URL: "http://unused.invalid"}
	server.Set("dashboard", cfg)
	if err := app.Save(server); err != nil {
		t.Fatal(err)
	}
	s.frps.cache[server.Id] = &frpsEntry{cfg: cfg, stats: ServerStats{Info: &FrpsInfo{VhostHTTPPort: portNumber}, Fetched: time.Now(), LastAttempt: time.Now(), RefreshState: "idle"}}
	t.Cleanup(s.frps.Stop)
	proxies := make([]*core.Record, count)
	for i := range proxies {
		proxies[i] = testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
			"name": "http-" + strconv.Itoa(i), "proxyType": "http", "serverId": server.Id,
			"localPort": 80, "customDomains": []string{addr}, "status": "enabled", "bootStatus": "online",
		})
	}
	return server, proxies
}

func awaitProbeSignal(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for probe")
	}
}

func TestProbeAllCancellationPreservesResults(t *testing.T) {
	for _, stopService := range []bool{false, true} {
		name := "caller cancellation"
		if stopService {
			name = "service stop"
		}
		t.Run(name, func(t *testing.T) {
			app := testutil.NewApp(t)
			started := make(chan struct{}, 2)
			var requests atomic.Int32
			target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				started <- struct{}{}
				<-r.Context().Done()
			}))
			defer target.Close()
			s := NewProbeService(app, NewFrpsService(app))
			defer s.Stop()
			_, proxies := saveHTTPProbeServer(t, app, s, target.URL, 2)
			previous := map[string]ProbeResult{"not-visited": {ProxyID: "not-visited", Reachable: true}}
			for _, p := range proxies {
				previous[p.Id] = ProbeResult{ProxyID: p.Id, Reachable: true, Checked: time.Now().Add(-time.Minute)}
			}
			for id, result := range previous {
				s.results[id] = result
			}
			var observed atomic.Int32
			s.SetObserver(func(string, string, []ProbeResult) { observed.Add(1) })
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan struct{})
			go func() {
				defer close(done)
				s.ProbeAll(ctx)
			}()
			awaitProbeSignal(t, started)

			// A second invocation must not start another round while this one is active.
			duplicateDone := make(chan struct{})
			go func() { defer close(duplicateDone); s.ProbeAll(ctx) }()
			awaitProbeSignal(t, duplicateDone)
			if stopService {
				stopped := make(chan struct{})
				go func() { defer close(stopped); s.Stop() }()
				awaitProbeSignal(t, stopped)
			} else {
				cancel()
			}
			awaitProbeSignal(t, done)
			if requests.Load() != 1 || observed.Load() != 0 {
				t.Errorf("requests=%d observations=%d; want 1, 0", requests.Load(), observed.Load())
			}
			if got := s.Results(); !reflect.DeepEqual(got, previous) {
				t.Errorf("cancelled round changed cached results: got %+v want %+v", got, previous)
			}
		})
	}
}

func TestProbeAllPublishesPartialResults(t *testing.T) {
	app := testutil.NewApp(t)
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()
	s := NewProbeService(app, NewFrpsService(app))
	defer s.Stop()
	_, proxies := saveHTTPProbeServer(t, app, s, target.URL, 2)
	var observed atomic.Int32
	s.SetObserver(func(string, string, []ProbeResult) { observed.Add(1) })
	done := make(chan struct{})
	go func() { defer close(done); s.ProbeAll(context.Background()) }()

	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for len(s.Results()) == 0 {
		select {
		case <-deadline.C:
			t.Fatal("completed probe was not published before the rest of the round")
		case <-ticker.C:
		}
	}
	s.Stop()
	awaitProbeSignal(t, done)
	results := s.Results()
	if len(results) != 1 || observed.Load() != 0 {
		t.Fatalf("partial round results=%+v observations=%d", results, observed.Load())
	}
	for _, result := range results {
		if !result.Reachable || result.Checked.IsZero() || (result.ProxyID != proxies[0].Id && result.ProxyID != proxies[1].Id) {
			t.Errorf("unexpected completed result: %+v", result)
		}
	}
}

func TestProbeAllServersProgressIndependently(t *testing.T) {
	app := testutil.NewApp(t)
	slowStarted := make(chan struct{}, 1)
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slowStarted <- struct{}{}
		<-r.Context().Done()
	}))
	defer slow.Close()
	fast := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer fast.Close()
	s := NewProbeService(app, NewFrpsService(app))
	defer s.Stop()
	slowServer, _ := saveHTTPProbeServer(t, app, s, slow.URL, 1)
	fastServer, proxies := saveHTTPProbeServer(t, app, s, fast.URL, 1)
	observed := make(chan string, 2)
	s.SetObserver(func(id, _ string, results []ProbeResult) {
		if id == fastServer.Id && (len(results) != 1 || results[0].Reachable || results[0].Error != "HTTP 503") {
			t.Errorf("unexpected full batch: %+v", results)
		}
		observed <- id
	})
	done := make(chan struct{})
	go func() { defer close(done); s.ProbeAll(context.Background()) }()
	awaitProbeSignal(t, slowStarted)
	select {
	case id := <-observed:
		if id != fastServer.Id {
			t.Fatalf("observed server %q before fast server %q", id, fastServer.Id)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("slow server blocked fast server's round")
	}
	if result, ok := s.Results()[proxies[0].Id]; !ok || result.Reachable || result.Error != "HTTP 503" {
		t.Errorf("failed probe not published: %+v, exists=%v", result, ok)
	}
	s.Stop()
	awaitProbeSignal(t, done)
	select {
	case id := <-observed:
		t.Errorf("cancelled server %q generated an observation (slow server %q)", id, slowServer.Id)
	default:
	}
}

func TestProbeAllEmptyRoundPrunesResults(t *testing.T) {
	app := testutil.NewApp(t)
	s := NewProbeService(app, NewFrpsService(app))
	defer s.Stop()
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "empty", "serverAddr": "127.0.0.1", "serverPort": 7000, "bootStatus": "running",
	})
	s.results["removed"] = ProbeResult{ProxyID: "removed", Reachable: true}
	var observed atomic.Int32
	s.SetObserver(func(id, _ string, results []ProbeResult) {
		if id != server.Id || len(results) != 0 {
			t.Errorf("unexpected empty batch: server=%q results=%+v", id, results)
		}
		observed.Add(1)
	})
	s.ProbeAll(context.Background())
	if len(s.Results()) != 0 || observed.Load() != 1 {
		t.Errorf("empty round results=%+v observations=%d", s.Results(), observed.Load())
	}
}
