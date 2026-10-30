package migrations_test

import (
	"testing"

	"podux/internal/testutil"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

func count(t *testing.T, app core.App, q string) int {
	t.Helper()
	var n int
	if err := app.DB().NewQuery(q).Row(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// TestSchemaCleanup rolls the cleanup back to get the old schema, seeds text ports
// and duplicate metrics like a pre-0.2.5 database, then migrates up again.
func TestSchemaCleanup(t *testing.T) {
	app := testutil.NewApp(t)
	revertThrough(t, app, "1793619660_schema_cleanup.go")

	if f := mustCollection(t, app, "fh_proxies").Fields.GetByName("remotePort"); f.Type() != core.FieldTypeText {
		t.Fatalf("rollback left remotePort as %s", f.Type())
	}
	if _, err := app.FindCollectionByNameOrId("fh_version"); err != nil {
		t.Fatal("rollback did not recreate fh_version")
	}

	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "s", "serverAddr": "1.1.1.1", "serverPort": "7000"})
	proxy := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "ssh", "proxyType": "tcp", "serverId": server.Id, "status": "enabled", "bootStatus": "offline",
		"localPort": "22", "remotePort": "",
	})
	t1 := testutil.SaveRecord(t, app, "fh_metrics_targets", map[string]any{"serverId": server.Id})
	t2 := testutil.SaveRecord(t, app, "fh_metrics_targets", map[string]any{"serverId": server.Id})
	at := "2026-10-01 10:00:00.000Z"
	for _, target := range []*core.Record{t1, t2} {
		testutil.SaveRecord(t, app, "fh_metrics_raw", map[string]any{"targetId": target.Id, "metricKey": "frps_delay", "t": at, "val": 10})
		testutil.SaveRecord(t, app, "fh_metrics_hourly", map[string]any{"targetId": target.Id, "metricKey": "frps_delay", "t": at, "valAvg": 10})
	}

	if err := app.RunAllMigrations(); err != nil {
		t.Fatal(err)
	}

	got, err := app.FindRecordById("fh_proxies", proxy.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got.GetInt("localPort") != 22 || got.GetInt("remotePort") != 0 {
		t.Errorf("ports = %v / %v", got.Get("localPort"), got.Get("remotePort"))
	}
	if s, _ := app.FindRecordById("fh_servers", server.Id); s.GetInt("serverPort") != 7000 {
		t.Errorf("serverPort = %v", s.Get("serverPort"))
	}
	if _, err := app.FindCollectionByNameOrId("fh_version"); err == nil {
		t.Error("fh_version still exists")
	}

	if n := count(t, app, "SELECT COUNT(*) FROM fh_metrics_targets"); n != 1 {
		t.Errorf("%d metrics targets, want the duplicates merged into 1", n)
	}
	if n := count(t, app, "SELECT COUNT(*) FROM fh_metrics_raw WHERE targetId = '"+t1.Id+"'"); n != 2 {
		t.Errorf("raw rows on the kept target = %d, want both", n)
	}
	if n := count(t, app, "SELECT COUNT(*) FROM fh_metrics_hourly"); n != 1 {
		t.Errorf("%d hourly rows, want duplicates dropped to 1", n)
	}

	// The unique index now rejects a second target for the same server.
	c := mustCollection(t, app, "fh_metrics_targets")
	dup := core.NewRecord(c)
	dup.Set("serverId", server.Id)
	if err := app.Save(dup); err == nil {
		t.Error("duplicate metrics target saved despite the unique index")
	}

	// Numeric ports still match PocketBase's "~" filter used by the proxy search.
	found, err := app.FindRecordsByFilter("fh_proxies", "localPort ~ {:q}", "", 0, 0, map[string]any{"q": "2"})
	if err != nil || len(found) != 1 {
		t.Errorf("port search: %d results, err %v", len(found), err)
	}
}

func mustCollection(t *testing.T, app core.App, name string) *core.Collection {
	t.Helper()
	c, err := app.FindCollectionByNameOrId(name)
	if err != nil {
		t.Fatal(err)
	}
	return c
}
