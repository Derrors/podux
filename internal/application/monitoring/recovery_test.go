package monitoring

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"podux/internal/testutil"
)

func TestRecoveryCompletedBucketsAndRestart(t *testing.T) {
	app := newTestApp(t)
	s := NewMetricsService(app)
	insertServer(t, app, "recovery0000001")
	target, err := s.getOrCreateServerTarget("recovery0000001")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	day := now.Truncate(24 * time.Hour)
	for _, point := range []struct {
		at  time.Time
		val float64
	}{{day.Add(-49 * time.Hour), 20}, {day.Add(-49*time.Hour + time.Minute), 40}, {day.Add(-25 * time.Hour), 70}, {now.Truncate(time.Hour).Add(-time.Hour), 90}, {now.Truncate(time.Hour), 999}} {
		insertRaw(t, app, target, point.at, point.val)
	}
	if err := s.CatchUp(context.Background()); err != nil {
		t.Fatal(err)
	}
	var hourly, daily int
	_ = app.DB().Select("COUNT(*)").From("fh_metrics_hourly").Row(&hourly)
	_ = app.DB().Select("COUNT(*)").From("fh_metrics_daily").Row(&daily)
	if hourly != 3 || daily < 2 {
		t.Fatalf("hourly=%d daily=%d", hourly, daily)
	}
	var current int
	_ = app.DB().Select("COUNT(*)").From("fh_metrics_hourly").Where(dbx.HashExp{"t": now.Truncate(time.Hour).Format(metricTimeFormat)}).Row(&current)
	if current != 0 {
		t.Fatal("current bucket was aggregated")
	}
	restarted := NewMetricsService(app)
	if err := restarted.CatchUp(context.Background()); err != nil {
		t.Fatal(err)
	}
	var count int
	_ = app.DB().Select("COUNT(*)").From("fh_metrics_hourly").Row(&count)
	if count != hourly {
		t.Fatal("recovery was not idempotent")
	}
	// Simulate another two completed hours after the persisted watermark.
	if err := restarted.aggregate(context.Background(), "hourly", now.Truncate(time.Hour).Add(2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	_ = app.DB().Select("COUNT(*)").From("fh_metrics_hourly").Row(&count)
	if count != hourly+1 {
		t.Fatalf("restart missed completed bucket: %d", count)
	}
}
func TestRecoveryPreservesHistoricalPartialBoundary(t *testing.T) {
	app := newTestApp(t)
	s := NewMetricsService(app)
	insertServer(t, app, "historical00001")
	target, _ := s.getOrCreateServerTarget("historical00001")
	from := time.Now().UTC().Add(-8 * 24 * time.Hour).Truncate(time.Hour)
	insertRaw(t, app, target, from.Add(40*time.Minute), 100)
	testutil.SaveRecord(t, app, "fh_metrics_hourly", map[string]any{"targetId": target, "metricKey": MetricKeyFrpsDelay, "t": from.Format(metricTimeFormat), "valAvg": 55, "valMin": 10, "valMax": 100})
	if err := s.PurgeOldRaw(); err != nil {
		t.Fatal(err)
	}
	var avg float64
	if err := app.DB().Select("valAvg").From("fh_metrics_hourly").Where(dbx.HashExp{"targetId": target, "t": from.Format(metricTimeFormat)}).Row(&avg); err != nil {
		t.Fatal(err)
	}
	if avg != 55 {
		t.Fatalf("partial retained raw overwrote full historical aggregate: %v", avg)
	}
	var count int
	_ = app.DB().Select("COUNT(*)").From("fh_metrics_raw").Row(&count)
	if count != 0 {
		t.Fatal("retention did not finish")
	}
	_ = app.DB().Select("COUNT(*)").From("fh_metrics_daily").Row(&count)
	if count != 1 {
		t.Fatal("raw purged before rollup recovery")
	}
}
func TestRecoveryFailureDoesNotAdvanceOrPurge(t *testing.T) {
	app := newTestApp(t)
	s := NewMetricsService(app)
	insertServer(t, app, "failure00000001")
	target, _ := s.getOrCreateServerTarget("failure00000001")
	insertRaw(t, app, target, time.Now().Add(-8*24*time.Hour), 25)
	_, err := app.DB().NewQuery(`CREATE TRIGGER fail_rollup BEFORE INSERT ON fh_metrics_hourly BEGIN SELECT RAISE(ABORT,'injected failure'); END`).Execute()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PurgeOldRaw(); err == nil {
		t.Fatal("expected injected aggregation failure")
	}
	var raw, state int
	_ = app.DB().Select("COUNT(*)").From("fh_metrics_raw").Row(&raw)
	_ = app.DB().Select("COUNT(*)").From("fh_metrics_state").Row(&state)
	if raw != 1 || state != 0 {
		t.Fatalf("failed recovery lost source or advanced watermark: raw=%d state=%d", raw, state)
	}
	_, _ = app.DB().NewQuery("DROP TRIGGER fail_rollup").Execute()
	if err := NewMetricsService(app).PurgeOldRaw(); err != nil {
		t.Fatal(err)
	}
}
func TestLatestFallbackOnlyMissingAndEndpointInvalidation(t *testing.T) {
	app := newTestApp(t)
	s := NewMetricsService(app)
	s.RegisterHooks()
	insertServer(t, app, "cachetest000001")
	insertServer(t, app, "cachetest000002")
	target, _ := s.getOrCreateServerTarget("cachetest000001")
	insertRaw(t, app, target, time.Now().Add(-time.Minute), 22)
	db := app.ConcurrentDB().(*dbx.DB)
	original := db.QueryLogFunc
	defer func() { db.QueryLogFunc = original }()
	rawQueries := 0
	db.QueryLogFunc = func(_ context.Context, _ time.Duration, query string, _ *sql.Rows, _ error) {
		if strings.Contains(query, "fh_metrics_raw") {
			rawQueries++
		}
	}
	first, err := s.GetLatestLatencyBatch()
	if err != nil || first["cachetest000001"] == nil {
		t.Fatalf("fallback %v %v", first, err)
	}
	queried := rawQueries
	for range 5 {
		if _, err := s.GetLatestLatencyBatch(); err != nil {
			t.Fatal(err)
		}
	}
	if queried != 1 || rawQueries != queried {
		t.Fatalf("cached calls repeated raw query: first=%d total=%d", queried, rawQueries)
	}
	t.Logf("first fallback: %d raw query; five warm reads: %d raw queries", queried, rawQueries-queried)
	record, _ := app.FindRecordById("fh_servers", "cachetest000001")
	late := s.beginLatency(record)
	late.latency = 500
	late.at = time.Now()
	record.Set("serverAddr", "127.0.0.2")
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	if got, err := s.recordLatencyBatch(context.Background(), []latencySample{late}); err != nil || len(got) != 0 {
		t.Fatalf("late probe accepted: %v %v", got, err)
	}
	for _, service := range []*MetricsService{s, NewMetricsService(app)} {
		got, err := service.GetLatestLatencyBatch()
		if err != nil {
			t.Fatal(err)
		}
		if got[record.Id] != nil {
			t.Fatal("old-address latency revived")
		}
	}
	if err := s.RecordServerLatency(record.Id, 44, ""); err != nil {
		t.Fatal(err)
	}
	s.latestLock.Lock()
	s.latest[record.Id].LastCheckTime = time.Now().Add(-11 * time.Minute)
	s.latestLock.Unlock()
	got, _ := s.GetLatestLatencyBatch()
	if got[record.Id] != nil {
		t.Fatal("stale cache revived database value")
	}
	if err := app.Delete(record); err != nil {
		t.Fatal(err)
	}
	got, _ = s.GetLatestLatencyBatch()
	if got[record.Id] != nil {
		t.Fatal("deleted server returned")
	}
}
func TestEachServerVisitsBeyond500AndCancellation(t *testing.T) {
	app := newTestApp(t)
	if err := app.RunInTransaction(func(tx core.App) error {
		for i := range 513 {
			_, err := tx.DB().Insert("fh_servers", dbx.Params{"id": fmt.Sprintf("server%09d", i), "serverName": "scale", "serverAddr": "127.0.0.1", "serverPort": 7000}).Execute()
			if err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	if err := eachServer(context.Background(), app, func(r *core.Record) { seen[r.Id] = true }); err != nil {
		t.Fatal(err)
	}
	if len(seen) != 513 {
		t.Fatalf("visited %d servers", len(seen))
	}
	ctx, cancel := context.WithCancel(context.Background())
	count := 0
	err := eachServer(ctx, app, func(*core.Record) { count++; cancel() })
	if err != context.Canceled || count != 1 {
		t.Fatalf("cancellation: visited=%d err=%v", count, err)
	}
}
