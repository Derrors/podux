package server

import (
	"errors"
	"testing"
	"time"

	"podux/internal/testutil"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

func seedServer(t *testing.T, app core.App, name string) (server *core.Record, proxyIDs []string) {
	t.Helper()
	server = testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": name, "serverAddr": "127.0.0.1", "serverPort": 7000, "bootStatus": "stopped",
	})
	for _, p := range []string{"web", "ssh"} {
		proxy := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
			"name": p, "proxyType": "tcp", "serverId": server.Id, "status": "enabled", "bootStatus": "offline",
		})
		proxyIDs = append(proxyIDs, proxy.Id)
	}
	testutil.SaveRecord(t, app, "fh_visitors", map[string]any{
		"name": "nas", "visitorType": "stcp", "serverId": server.Id, "serverName": "nas", "status": "enabled",
	})
	target := testutil.SaveRecord(t, app, "fh_metrics_targets", map[string]any{"serverId": server.Id})
	at := time.Now().UTC().Format("2006-01-02 15:04:05.000Z")
	for _, c := range []string{"fh_metrics_raw", "fh_metrics_hourly", "fh_metrics_daily"} {
		fields := map[string]any{"targetId": target.Id, "metricKey": "frps_delay", "t": at}
		if c == "fh_metrics_raw" {
			fields["val"] = 12
		}
		testutil.SaveRecord(t, app, c, fields)
	}
	return server, proxyIDs
}

func count(t *testing.T, app core.App, table, where string, params map[string]any) int {
	t.Helper()
	var n int
	if err := app.DB().NewQuery("SELECT COUNT(*) FROM " + table + " WHERE " + where).Bind(params).Row(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestDeleteServerCascades(t *testing.T) {
	app := testutil.NewApp(t)
	var deleted []string
	RegisterDeleteHooks(app, func(id string) { deleted = append(deleted, id) })

	victim, _ := seedServer(t, app, "victim")
	keep, _ := seedServer(t, app, "keep")

	if err := app.Delete(victim); err != nil {
		t.Fatalf("delete server with proxies: %v", err)
	}

	if n := count(t, app, "fh_proxies", "serverId = {:id}", map[string]any{"id": victim.Id}); n != 0 {
		t.Fatalf("%d proxies left for deleted server", n)
	}
	if n := count(t, app, "fh_visitors", "serverId = {:id}", map[string]any{"id": victim.Id}); n != 0 {
		t.Fatalf("%d visitors left for deleted server", n)
	}
	if n := count(t, app, "fh_visitors", "serverId = {:id}", map[string]any{"id": keep.Id}); n != 1 {
		t.Fatalf("other server lost visitors: %d left", n)
	}
	if n := count(t, app, "fh_metrics_targets", "serverId = {:id} OR serverId = ''", map[string]any{"id": victim.Id}); n != 0 {
		t.Fatalf("%d metrics targets left (incl. orphaned)", n)
	}
	for _, table := range []string{"fh_metrics_raw", "fh_metrics_hourly", "fh_metrics_daily"} {
		if n := count(t, app, table, "1=1", nil); n != 1 {
			t.Fatalf("%s has %d rows, want only the other server's 1", table, n)
		}
	}
	if n := count(t, app, "fh_proxies", "serverId = {:id}", map[string]any{"id": keep.Id}); n != 2 {
		t.Fatalf("other server lost proxies: %d left", n)
	}
	if len(deleted) != 1 || deleted[0] != victim.Id {
		t.Fatalf("onDeleted calls = %v, want [%s]", deleted, victim.Id)
	}
}

func TestDeleteServerFailureRollsBack(t *testing.T) {
	app := testutil.NewApp(t)
	called := false
	RegisterDeleteHooks(app, func(string) { called = true })
	server, proxyIDs := seedServer(t, app, "s")

	// Make the final delete fail after the dependents were removed in the transaction.
	app.OnRecordDeleteExecute("fh_servers").BindFunc(func(e *core.RecordEvent) error {
		return errors.New("forced failure")
	})
	if err := app.Delete(server); err == nil {
		t.Fatal("expected delete to fail")
	}
	for _, id := range proxyIDs {
		if _, err := app.FindRecordById("fh_proxies", id); err != nil {
			t.Fatalf("proxy %s deleted although the server delete failed: %v", id, err)
		}
	}
	if called {
		t.Fatal("onDeleted ran for a failed delete")
	}
}
