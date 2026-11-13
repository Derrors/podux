package migrations_test

import (
	"testing"

	"podux/internal/testutil"
)

func TestServerProbePublicHTTPSMigration(t *testing.T) {
	app := testutil.NewApp(t)
	revertThrough(t, app, "1794051661_server_probe_public_https.go")
	if mustCollection(t, app, "fh_servers").Fields.GetByName("probePublicHTTPS") != nil {
		t.Fatal("probePublicHTTPS remains after rollback")
	}
	old := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "s", "serverAddr": "127.0.0.1", "serverPort": 7000,
		"dashboard": map[string]any{"url": "http://127.0.0.1:7500", "user": "admin"},
	})
	dashboard := old.GetString("dashboard")
	if err := app.RunAllMigrations(); err != nil {
		t.Fatal(err)
	}
	old, err := app.FindRecordById("fh_servers", old.Id)
	if err != nil {
		t.Fatal(err)
	}
	if old.GetBool("probePublicHTTPS") || old.GetString("dashboard") != dashboard {
		t.Fatal("migration changed how an existing server is probed")
	}
	old.Set("probePublicHTTPS", true)
	if err := app.Save(old); err != nil {
		t.Fatal(err)
	}
	if old, err = app.FindRecordById("fh_servers", old.Id); err != nil || !old.GetBool("probePublicHTTPS") {
		t.Fatalf("setting was not persisted: %v", err)
	}
	revertThrough(t, app, "1794051661_server_probe_public_https.go")
	if mustCollection(t, app, "fh_servers").Fields.GetByName("probePublicHTTPS") != nil {
		t.Fatal("probePublicHTTPS remains after rollback with data")
	}
	if old, err = app.FindRecordById("fh_servers", old.Id); err != nil || old.GetString("dashboard") != dashboard || old.GetInt("serverPort") != 7000 {
		t.Fatalf("rollback changed the server: %v", err)
	}
}
