package migrations_test

import (
	"testing"

	"podux/internal/testutil"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

func TestSecretProxiesAndVisitors(t *testing.T) {
	app := testutil.NewApp(t)

	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "s", "serverAddr": "127.0.0.1", "serverPort": 7000,
	})
	p := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "nas", "proxyType": "stcp", "serverId": server.Id, "localPort": 22,
		"status": "enabled", "bootStatus": "offline",
		"secretKey": "k", "allowUsers": []string{"*"},
		"healthCheck": map[string]any{"type": "tcp", "intervalSeconds": 10},
	})
	got, err := app.FindRecordById("fh_proxies", p.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got.GetString("secretKey") != "k" || got.GetString("proxyType") != "stcp" {
		t.Fatalf("stcp proxy not stored: %v", got.PublicExport())
	}

	testutil.SaveRecord(t, app, "fh_visitors", map[string]any{
		"name": "nas-visitor", "visitorType": "xtcp", "serverId": server.Id,
		"serverName": "nas-" + p.Id, "secretKey": "k", "bindAddr": "127.0.0.1", "bindPort": 6000,
		"keepTunnelOpen": true, "status": "enabled",
	})
}

func TestSecretProxiesAndVisitorsRollback(t *testing.T) {
	app := testutil.NewApp(t)

	revertThrough(t, app, "1793446860_stcp_visitors.go")
	if _, err := app.FindCollectionByNameOrId("fh_visitors"); err == nil {
		t.Fatal("fh_visitors still exists after rollback")
	}
	proxies, err := app.FindCollectionByNameOrId("fh_proxies")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"secretKey", "allowUsers", "healthCheck"} {
		if proxies.Fields.GetByName(name) != nil {
			t.Errorf("%s still present after rollback", name)
		}
	}
	if values := proxies.Fields.GetByName("proxyType").(*core.SelectField).Values; len(values) != 4 {
		t.Errorf("proxyType values after rollback: %v", values)
	}
}
