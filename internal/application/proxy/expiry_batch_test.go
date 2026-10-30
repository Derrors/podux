package proxy

import (
	"errors"
	"testing"
	"time"

	"podux/internal/testutil"

	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
)

func TestDisableExpired(t *testing.T) {
	app := testutil.NewApp(t)
	s := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "home", "serverAddr": "1.1.1.1", "serverPort": 7000})
	now := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	mk := func(name, expires string) string {
		return testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
			"name": name, "proxyType": "tcp", "serverId": s.Id, "localPort": 22, "status": "enabled", "bootStatus": "offline",
			"expiresAt": expires,
		}).Id
	}
	expired := mk("ssh", "2026-10-30 11:59:00.000Z")
	future := mk("web", "2026-10-30 13:00:00.000Z")
	forever := mk("db", "")

	var reported []string
	n, err := DisableExpired(app, now, func(serverID, serverName string, names []string) {
		if serverID != s.Id || serverName != "home" {
			t.Errorf("reported for %s/%s", serverID, serverName)
		}
		reported = append(reported, names...)
	})
	if err != nil || n != 1 || len(reported) != 1 || reported[0] != "ssh" {
		t.Fatalf("disabled %d (%v), reported %v", n, err, reported)
	}
	for id, want := range map[string]string{expired: "disabled", future: "enabled", forever: "enabled"} {
		r, _ := app.FindRecordById("fh_proxies", id)
		if r.GetString("status") != want {
			t.Errorf("%s status = %s, want %s", r.GetString("name"), r.GetString("status"), want)
		}
	}
	if r, _ := app.FindRecordById("fh_proxies", expired); !r.GetDateTime("expiresAt").IsZero() {
		t.Error("expiresAt not cleared, so enabling the proxy again would disable it at once")
	}
}

func TestBatch(t *testing.T) {
	app := testutil.NewApp(t)
	RegisterConflictChecks(app)
	s1 := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "a", "serverAddr": "1.1.1.1", "serverPort": 7000})
	s2 := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "b", "serverAddr": "2.2.2.2", "serverPort": 7000})
	mk := func(server, name string, port int, status string) string {
		return testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
			"name": name, "proxyType": "tcp", "serverId": server, "localPort": 22, "remotePort": port,
			"status": status, "bootStatus": "offline",
		}).Id
	}
	a := mk(s1.Id, "a", 6000, "enabled")
	b := mk(s1.Id, "b", 6001, "enabled")
	c := mk(s2.Id, "c", 6000, "enabled") // same port on the other server

	if n, err := Batch(app, []string{a, b}, BatchDisable, ""); err != nil || n != 2 {
		t.Fatalf("disable: %d %v", n, err)
	}

	// Moving c onto s1 is fine while a is disabled ...
	if _, err := Batch(app, []string{c}, BatchMove, s1.Id); err != nil {
		t.Fatalf("move: %v", err)
	}
	// ... but enabling a and b then conflicts with c on port 6000, so nothing changes.
	_, err := Batch(app, []string{b, a}, BatchEnable, "")
	var batchErr *BatchError
	var verrs validation.Errors
	if !errors.As(err, &batchErr) || batchErr.ProxyName != "a" || !errors.As(err, &verrs) {
		t.Fatalf("enable error = %v", err)
	}
	if r, _ := app.FindRecordById("fh_proxies", b); r.GetString("status") != "disabled" {
		t.Error("the batch was not rolled back: b is enabled")
	}

	if n, err := Batch(app, []string{a, b}, BatchDelete, ""); err != nil || n != 2 {
		t.Fatalf("delete: %d %v", n, err)
	}
	for _, bad := range [][]any{{[]string{}, BatchEnable, ""}, {[]string{c}, "explode", ""}, {[]string{c}, BatchMove, ""}} {
		if _, err := Batch(app, bad[0].([]string), bad[1].(string), bad[2].(string)); !errors.Is(err, ErrInvalidBatch) {
			t.Errorf("Batch%v = %v, want ErrInvalidBatch", bad, err)
		}
	}
}
