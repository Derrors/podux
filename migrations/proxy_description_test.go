package migrations_test

import (
	"testing"

	"podux/internal/testutil"
)

func TestProxyDescriptionPersists(t *testing.T) {
	app := testutil.NewApp(t)

	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "s", "serverAddr": "127.0.0.1", "serverPort": 7000,
	})
	p := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "web", "proxyType": "tcp", "serverId": server.Id,
		"status": "enabled", "bootStatus": "offline", "description": "home NAS",
	})

	got, err := app.FindRecordById("fh_proxies", p.Id)
	if err != nil {
		t.Fatal(err)
	}
	if d := got.GetString("description"); d != "home NAS" {
		t.Fatalf("description = %q, want %q", d, "home NAS")
	}
}

func TestProxyDescriptionRollback(t *testing.T) {
	app := testutil.NewApp(t)

	revertThrough(t, app, "1793360460_proxy_description.go")
	collection, err := app.FindCollectionByNameOrId("fh_proxies")
	if err != nil {
		t.Fatal(err)
	}
	if collection.Fields.GetByName("description") != nil {
		t.Fatal("description field still present after rollback")
	}
}
