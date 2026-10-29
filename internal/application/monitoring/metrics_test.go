package monitoring

import (
	"testing"
	"time"

	_ "podux/migrations"

	"github.com/pocketbase/pocketbase/core"
)

func newTestApp(t *testing.T) core.App {
	t.Helper()
	app := core.NewBaseApp(core.BaseAppConfig{DataDir: t.TempDir()})
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	if err := app.RunAllMigrations(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })
	return app
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
