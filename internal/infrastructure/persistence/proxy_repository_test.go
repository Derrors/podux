package persistence

import (
	"testing"

	"podux/internal/domain/proxy"
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

func saveRecord(t *testing.T, app core.App, collectionName string, fields map[string]any) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(collection)
	r.Load(fields)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}

func TestProxyBootStatusUpdates(t *testing.T) {
	app := newTestApp(t)
	repo := NewProxyRepository(app)

	server := saveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "s", "serverAddr": "127.0.0.1", "serverPort": 7000, "bootStatus": "stopped",
	})
	p := saveRecord(t, app, "fh_proxies", map[string]any{
		"name": "web", "proxyType": "tcp", "serverId": server.Id,
		"status": string(proxy.ProxyStatusEnabled), "bootStatus": string(proxy.ProxyBootStatusOffline),
	})

	bootStatus := func() string {
		r, err := app.FindRecordById("fh_proxies", p.Id)
		if err != nil {
			t.Fatal(err)
		}
		return r.GetString("bootStatus")
	}

	for _, status := range []proxy.ProxyBootStatus{proxy.ProxyBootStatusOnline, proxy.ProxyBootStatusOnline} {
		if err := repo.UpdateBootStatus(p.Id, status); err != nil {
			t.Fatal(err)
		}
		if got := bootStatus(); got != string(status) {
			t.Fatalf("bootStatus = %q, want %q", got, status)
		}
	}

	if err := repo.UpdateBootStatusByServerID(server.Id, proxy.ProxyBootStatusOffline); err != nil {
		t.Fatal(err)
	}
	if got := bootStatus(); got != string(proxy.ProxyBootStatusOffline) {
		t.Fatalf("bootStatus = %q after server-wide update, want offline", got)
	}
}
