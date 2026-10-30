package migrations_test

import (
	"testing"

	"podux/internal/testutil"
)

func TestProxyOptionsRollback(t *testing.T) {
	app := testutil.NewApp(t)

	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "s", "serverAddr": "1.1.1.1", "serverPort": 7000,
		"dashboard": map[string]any{"url": "http://1.1.1.1:7500", "user": "admin"},
	})
	testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "mux", "proxyType": "tcpmux", "serverId": server.Id, "status": "enabled", "bootStatus": "offline",
		"options":   map[string]any{"multiplexer": "httpconnect", "loadBalancer": map[string]any{"group": "g"}},
		"expiresAt": "2030-01-01 00:00:00.000Z",
	})
	testutil.SaveRecord(t, app, "fh_visitors", map[string]any{
		"name": "v", "visitorType": "xtcp", "serverId": server.Id, "serverName": "x", "status": "enabled",
		"fallbackTo": "abcdefghijklmno", "fallbackTimeoutMs": 1000,
	})

	revertThrough(t, app, "1793706060_proxy_options.go")
	for collection, fields := range map[string][]string{
		"fh_proxies":  {"options", "expiresAt"},
		"fh_visitors": {"fallbackTo", "fallbackTimeoutMs"},
		"fh_servers":  {"dashboard"},
	} {
		c := mustCollection(t, app, collection)
		for _, f := range fields {
			if c.Fields.GetByName(f) != nil {
				t.Errorf("%s.%s still present after rollback", collection, f)
			}
		}
	}
}
