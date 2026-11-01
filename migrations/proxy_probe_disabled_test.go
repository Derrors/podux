package migrations_test

import (
	"testing"

	"podux/internal/testutil"
)

func TestProxyProbeDisabledMigration(t *testing.T) {
	app := testutil.NewApp(t)
	revertThrough(t, app, "1793878860_proxy_probe_disabled.go")
	if mustCollection(t, app, "fh_proxies").Fields.GetByName("probeDisabled") != nil {
		t.Fatal("probeDisabled remains after rollback")
	}
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "s", "serverAddr": "127.0.0.1", "serverPort": 7000,
	})
	old := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "ssh", "proxyType": "tcp", "serverId": server.Id, "localPort": 22, "remotePort": 6022,
		"status": "enabled", "bootStatus": "online", "healthCheck": map[string]any{"type": "tcp", "intervalSeconds": 10},
	})
	if err := app.RunAllMigrations(); err != nil {
		t.Fatal(err)
	}
	old, err := app.FindRecordById("fh_proxies", old.Id)
	if err != nil {
		t.Fatal(err)
	}
	if old.GetBool("probeDisabled") || old.GetString("status") != "enabled" || old.GetInt("localPort") != 22 {
		t.Fatal("migration disabled an existing probe or changed its tunnel")
	}
	health := old.GetString("healthCheck")
	fresh := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "new", "proxyType": "tcp", "serverId": server.Id, "localPort": 80,
		"status": "enabled", "bootStatus": "offline",
	})
	if fresh.GetBool("probeDisabled") {
		t.Fatal("omitted field should leave new/imported proxy probes enabled")
	}
	old.Set("probeDisabled", true)
	if err := app.Save(old); err != nil {
		t.Fatal(err)
	}
	old, err = app.FindRecordById("fh_proxies", old.Id)
	if err != nil || !old.GetBool("probeDisabled") || old.GetString("healthCheck") != health {
		t.Fatalf("opt-out was not persisted independently of healthCheck: %v", err)
	}
	revertThrough(t, app, "1793878860_proxy_probe_disabled.go")
	if mustCollection(t, app, "fh_proxies").Fields.GetByName("probeDisabled") != nil {
		t.Fatal("probeDisabled remains after rollback with data")
	}
	old, err = app.FindRecordById("fh_proxies", old.Id)
	if err != nil || old.GetString("healthCheck") != health || old.GetString("status") != "enabled" {
		t.Fatalf("rollback changed tunnel configuration: %v", err)
	}
}
