package monitoring

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"podux/pkg/utils"
)

func TestMonitor513ServersAndStopWait(t *testing.T) {
	app := newTestApp(t)
	if err := app.RunInTransaction(func(tx core.App) error {
		for i := range 513 {
			_, err := tx.DB().Insert("fh_servers", dbx.Params{"id": fmt.Sprintf("server%09d", i), "serverName": "scale", "serverAddr": "127.0.0.1", "serverPort": 7000, "geoLocation": `{"city":"local"}`}).Execute()
			if err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	metrics := NewMetricsService(app)
	monitor := NewMonitorService(app, NewGeoService(app), metrics)
	var starts, active, peak atomic.Int32
	monitor.ping = func(ctx context.Context, _ string, _ time.Duration) utils.PingResult {
		starts.Add(1)
		n := active.Add(1)
		defer active.Add(-1)
		for old := peak.Load(); n > old; old = peak.Load() {
			if peak.CompareAndSwap(old, n) {
				break
			}
		}
		return utils.PingResult{Latency: 1, Reachable: true}
	}
	monitor.Start(time.Hour, time.Hour)
	waitFor(t, func() bool {
		metrics.latestLock.RLock()
		defer metrics.latestLock.RUnlock()
		return len(metrics.latest) == 513
	})
	monitor.Stop()
	if starts.Load() != 513 || active.Load() != 0 || peak.Load() > latencyConcurrency {
		t.Fatalf("starts=%d active=%d peak=%d", starts.Load(), active.Load(), peak.Load())
	}
	// A second monitor blocks every probe until cancellation. Stop waits for both
	// the fixed pool and aggregator, and must not emit unreachable cancellations.
	monitor = NewMonitorService(app, NewGeoService(app), NewMetricsService(app))
	started := make(chan struct{}, latencyConcurrency)
	monitor.ping = func(ctx context.Context, _ string, _ time.Duration) utils.PingResult {
		active.Add(1)
		defer active.Add(-1)
		started <- struct{}{}
		<-ctx.Done()
		return utils.PingResult{Latency: -1, Error: ctx.Err().Error()}
	}
	monitor.Start(time.Hour, time.Hour)
	awaitProbeSignal(t, started)
	done := make(chan struct{})
	go func() { monitor.Stop(); close(done) }()
	awaitProbeSignal(t, done)
	if active.Load() != 0 || len(monitor.metricsService.latest) != 0 {
		t.Fatal("Stop leaked work or published cancellation")
	}
	monitor.Stop()
	monitor.Start(time.Second, time.Second)
}
func TestGlobalProbeSlotsBoundedAndCancellable(t *testing.T) {
	var active, peak atomic.Int32
	started := make(chan struct{}, 64)
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := active.Add(1)
		defer active.Add(-1)
		for old := peak.Load(); n > old; old = peak.Load() {
			if peak.CompareAndSwap(old, n) {
				break
			}
		}
		started <- struct{}{}
		<-r.Context().Done()
	}))
	defer remote.Close()
	s := NewProbeService(nil, nil)
	defer s.Stop()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var wg sync.WaitGroup
	for range 64 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = s.runProbe(ctx, probeTarget{proxyType: "http", endpoint: remote.Listener.Addr().String(), host: "test", path: "/"})
		}()
	}
	for range probeGlobalConcurrency {
		awaitProbeSignal(t, started)
	}
	if peak.Load() > probeGlobalConcurrency {
		t.Fatalf("global peak=%d", peak.Load())
	}
	cancel()
	wg.Wait()
	if len(s.slots) != 0 {
		t.Fatal("cancelled probes retained global slots")
	}
}
