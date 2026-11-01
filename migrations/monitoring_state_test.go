package migrations_test

import (
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"podux/internal/testutil"
)

func queryPlan(t *testing.T, app core.App, query string) string {
	t.Helper()
	var rows []struct {
		Detail string `db:"detail"`
	}
	if err := app.DB().NewQuery("EXPLAIN QUERY PLAN " + query).All(&rows); err != nil {
		t.Fatal(err)
	}
	parts := []string{}
	for _, r := range rows {
		parts = append(parts, r.Detail)
	}
	return strings.Join(parts, "; ")
}
func TestMonitoringIndexPlansAndRollback(t *testing.T) {
	app := testutil.NewApp(t)
	rangeQuery := `SELECT targetId,metricKey,AVG(val) FROM fh_metrics_raw WHERE t >= '2026-10-01' AND t < '2026-10-02' GROUP BY targetId,metricKey`
	latestQuery := `SELECT id FROM fh_metrics_raw WHERE targetId='server000000001' AND metricKey='frps_delay' AND t >= '2026-10-01' ORDER BY t DESC LIMIT 1`
	rangePlan := queryPlan(t, app, rangeQuery)
	latestPlan := queryPlan(t, app, latestQuery)
	if !strings.Contains(rangePlan, "idx_fh_metrics_raw_time") || !strings.Contains(latestPlan, "idx_fh_metrics_raw_latest") {
		t.Fatalf("unexpected plans: %s / %s", rangePlan, latestPlan)
	}
	if strings.Contains(latestPlan, "TEMP B-TREE") {
		t.Fatal("latest lookup sorts instead of index seeking")
	}
	for _, table := range []string{"fh_metrics_raw", "fh_metrics_hourly", "fh_metrics_daily"} {
		plan := queryPlan(t, app, "SELECT id FROM "+table+" WHERE t < '2026-10-01' ORDER BY t LIMIT 2000")
		if !strings.Contains(plan, "idx_"+table+"_time") {
			t.Fatalf("retention scan not indexed: %s", plan)
		}
		t.Logf("%s retention: %s", table, plan)
	}
	state := mustCollection(t, app, "fh_metrics_state")
	if state.ListRule != nil || state.ViewRule != nil || state.CreateRule != nil || state.UpdateRule != nil || state.DeleteRule != nil {
		t.Fatal("watermark exposed through API")
	}
	testutil.SaveRecord(t, app, "fh_metrics_state", map[string]any{"kind": "hourly", "watermark": "2026-10-01 00:00:00.000Z"})
	duplicate := core.NewRecord(state)
	duplicate.Set("kind", "hourly")
	duplicate.Set("watermark", "2026-10-02 00:00:00.000Z")
	if app.Save(duplicate) == nil {
		t.Fatal("duplicate watermark kind accepted")
	}
	revertThrough(t, app, "1793965261_monitoring_state.go")
	oldPlan := queryPlan(t, app, rangeQuery)
	t.Logf("raw aggregation before: %s", oldPlan)
	t.Logf("raw aggregation after: %s", rangePlan)
	t.Logf("latest lookup after: %s", latestPlan)
	if strings.Contains(oldPlan, "idx_fh_metrics_raw_time") {
		t.Fatal("rollback retained new index")
	}
	if _, err := app.FindCollectionByNameOrId("fh_metrics_state"); err == nil {
		t.Fatal("rollback retained state")
	}
	if mustCollection(t, app, "fh_metrics_targets").Fields.GetByName("latencySince") != nil {
		t.Fatal("rollback retained latency boundary")
	}
	if err := app.RunAllMigrations(); err != nil {
		t.Fatal(err)
	}
}
