package monitoring

import (
	"testing"
	"time"

	"podux/internal/testutil"

	"github.com/pocketbase/pocketbase/core"
)

func newTestApp(t *testing.T) core.App {
	t.Helper()
	return testutil.NewApp(t)
}

func insertServer(t *testing.T, app core.App, id string) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("fh_servers")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(collection)
	r.Id = id
	r.Set("serverName", id)
	r.Set("serverAddr", "127.0.0.1")
	r.Set("serverPort", 7000)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
}

func insertRaw(t *testing.T, app core.App, targetID string, at time.Time, val float64) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("fh_metrics_raw")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(collection)
	r.Set("targetId", targetID)
	r.Set("metricKey", MetricKeyFrpsDelay)
	r.Set("t", at.UTC().Format("2006-01-02 15:04:05.000Z"))
	r.Set("val", val)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
}

func TestGetLatestLatencyBatch(t *testing.T) {
	app := newTestApp(t)
	s := NewMetricsService(app)
	insertServer(t, app, "freshserver0001")
	insertServer(t, app, "staleserver0001")

	fresh, err := s.getOrCreateServerTarget("freshserver0001")
	if err != nil {
		t.Fatal(err)
	}
	stale, err := s.getOrCreateServerTarget("staleserver0001")
	if err != nil {
		t.Fatal(err)
	}

	now := time.Now()
	insertRaw(t, app, fresh, now.Add(-3*time.Minute), 80)
	insertRaw(t, app, fresh, now.Add(-1*time.Minute), 42)
	insertRaw(t, app, fresh, now.Add(-2*time.Minute), 99)
	insertRaw(t, app, stale, now.Add(-2*time.Hour), 10)

	got, err := s.GetLatestLatencyBatch()
	if err != nil {
		t.Fatal(err)
	}
	if st := got["freshserver0001"]; st == nil || st.Latency != 42 || !st.Reachable {
		t.Fatalf("fresh server status = %+v, want latest latency 42", st)
	}
	if st := got["staleserver0001"]; st != nil {
		t.Fatalf("stale measurement should be ignored, got %+v", st)
	}

	// A failed probe overrides the stored value and is reported as unreachable.
	if err := s.RecordServerLatency("freshserver0001", -1, "connection refused"); err != nil {
		t.Fatal(err)
	}
	got, err = s.GetLatestLatencyBatch()
	if err != nil {
		t.Fatal(err)
	}
	if st := got["freshserver0001"]; st == nil || st.Reachable || st.Error != "connection refused" {
		t.Fatalf("status after failed probe = %+v, want unreachable", st)
	}
}

func TestMaxLatestLatencyAndForget(t *testing.T) {
	app := newTestApp(t)
	s := NewMetricsService(app)

	_ = s.RecordServerLatency("aaaaaaaaaaaaaaa", 30, "")
	_ = s.RecordServerLatency("bbbbbbbbbbbbbbb", 120, "")
	_ = s.RecordServerLatency("ccccccccccccccc", -1, "timeout")

	if got, err := s.MaxLatestLatency(); err != nil || got != 120 {
		t.Fatalf("MaxLatestLatency = %d, %v; want 120 (unreachable ignored)", got, err)
	}

	s.ForgetServer("bbbbbbbbbbbbbbb")
	if got, _ := s.MaxLatestLatency(); got != 30 {
		t.Fatalf("after ForgetServer, MaxLatestLatency = %d, want 30", got)
	}
}

func TestPurgeOldDaily(t *testing.T) {
	app := newTestApp(t)
	s := NewMetricsService(app)
	insertServer(t, app, "dailyserver0001")
	target, err := s.getOrCreateServerTarget("dailyserver0001")
	if err != nil {
		t.Fatal(err)
	}
	collection, err := app.FindCollectionByNameOrId("fh_metrics_daily")
	if err != nil {
		t.Fatal(err)
	}
	for _, at := range []time.Time{time.Now().AddDate(-2, 0, 0), time.Now().AddDate(0, 0, -1)} {
		r := core.NewRecord(collection)
		r.Set("targetId", target)
		r.Set("metricKey", MetricKeyFrpsDelay)
		r.Set("t", at.UTC().Format("2006-01-02 15:04:05.000Z"))
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
	}

	if err := s.PurgeOldDaily(); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := app.DB().NewQuery("SELECT COUNT(*) FROM fh_metrics_daily").Row(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("%d daily rows left, want 1", n)
	}
}

func TestMonitorStopIsIdempotent(t *testing.T) {
	m := NewMonitorService(core.NewBaseApp(core.BaseAppConfig{}), nil, nil)
	m.Stop()
	m.Stop()
}
