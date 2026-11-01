package frpc

import (
	"reflect"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"podux/internal/infrastructure/persistence"
	"podux/internal/testutil"
)

func TestProxyNeedsReload(t *testing.T) {
	app := testutil.NewApp(t)
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "s", "serverAddr": "127.0.0.1", "serverPort": 7000,
	})
	proxy := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "ssh", "proxyType": "tcp", "serverId": server.Id, "localPort": 22,
		"remotePort": 6022, "status": "enabled", "bootStatus": "online",
	})
	var reloads []bool
	app.OnRecordAfterUpdateSuccess("fh_proxies").BindFunc(func(e *core.RecordEvent) error {
		reloads = append(reloads, ProxyNeedsReload(e.Record))
		return e.Next()
	})
	for _, change := range []map[string]any{
		{"probeDisabled": true},
		{"probeDisabled": false},
		{"probeDisabled": true, "remotePort": 6023},
		{"status": "disabled"},
	} {
		record, err := app.FindRecordById("fh_proxies", proxy.Id)
		if err != nil {
			t.Fatal(err)
		}
		record.Load(change)
		if err := app.Save(record); err != nil {
			t.Fatal(err)
		}
	}
	if want := []bool{false, false, true, true}; !reflect.DeepEqual(reloads, want) {
		t.Fatalf("reloads=%v, want %v", reloads, want)
	}
}

func TestProbeSettingLeavesFrpcConfigUnchanged(t *testing.T) {
	app := testutil.NewApp(t)
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "s", "serverAddr": "127.0.0.1", "serverPort": 7000,
	})
	var proxies []*core.Record
	for i, health := range []any{nil, map[string]any{"type": "tcp", "intervalSeconds": 10}} {
		proxies = append(proxies, testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
			"name": "ssh", "proxyType": "tcp", "serverId": server.Id, "localPort": 22,
			"remotePort": 6022 + i, "status": "enabled", "bootStatus": "offline", "healthCheck": health,
		}))
	}
	fs := NewService(app, persistence.NewServerRepository(app), persistence.NewProxyRepository(app), persistence.NewVisitorRepository(app))
	before, err := fs.genProxyCfgs(&server.Id)
	if err != nil {
		t.Fatal(err)
	}
	for _, proxy := range proxies {
		proxy.Set("probeDisabled", true)
		if err := app.Save(proxy); err != nil {
			t.Fatal(err)
		}
	}
	after, err := fs.genProxyCfgs(&server.Id)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != 2 || !reflect.DeepEqual(before, after) {
		t.Fatal("turning off public probes changed frpc proxies or healthCheck")
	}
}
