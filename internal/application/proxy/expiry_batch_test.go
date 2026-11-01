package proxy

import (
	"errors"
	"testing"
	"time"

	"podux/internal/testutil"

	"ganigeorgiev.com/pocketbase/dbx"
	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
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

type expiryScanBarrierApp struct {
	core.App
	scanned chan struct{}
	resume  chan struct{}
}

func (a *expiryScanBarrierApp) FindAllRecords(collection any, exprs ...dbx.Expression) ([]*core.Record, error) {
	records, err := a.App.FindAllRecords(collection, exprs...)
	close(a.scanned)
	<-a.resume
	return records, err
}

func TestDisableExpiredRechecksAfterConcurrentEdit(t *testing.T) {
	for _, edit := range []string{"renew", "clear expiry", "disable", "move and retarget", "delete"} {
		t.Run(edit, func(t *testing.T) {
			app := testutil.NewApp(t)
			RegisterConflictChecks(app)
			s1 := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "old", "serverAddr": "1.1.1.1", "serverPort": 7000})
			s2 := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "new", "serverAddr": "2.2.2.2", "serverPort": 7000})
			r := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
				"name": "old", "proxyType": "tcp", "serverId": s1.Id, "localPort": 22,
				"status": "enabled", "bootStatus": "offline", "expiresAt": "2026-10-30 11:59:00.000Z",
			})
			wrapped := &expiryScanBarrierApp{App: app, scanned: make(chan struct{}), resume: make(chan struct{})}
			type result struct {
				n   int
				err error
			}
			results := make(chan result, 1)
			reported := make(chan string, 1)
			go func() {
				n, err := DisableExpired(wrapped, time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC), func(id, name string, names []string) {
					reported <- id + "/" + name + "/" + names[0]
				})
				results <- result{n, err}
			}()
			<-wrapped.scanned
			switch edit {
			case "renew":
				r.Set("expiresAt", "2026-11-30 12:00:00.000Z")
			case "clear expiry":
				r.Set("expiresAt", "")
			case "disable":
				r.Set("status", "disabled")
			case "move and retarget":
				r.Set("serverId", s2.Id)
				r.Set("name", "edited")
				r.Set("localPort", 8080)
				r.Set("description", "keep this edit")
				r.Set("options", map[string]any{"transport": map[string]any{"useEncryption": true}})
			}
			if edit == "delete" {
				if err := app.Delete(r); err != nil {
					t.Fatal(err)
				}
			} else if err := app.Save(r); err != nil {
				t.Fatal(err)
			}

			// After-success still runs against a usable, committed app, once per
			// actual expiry; it can read and write without a nested-lock deadlock.
			hooks := 0
			app.OnRecordAfterUpdateSuccess("fh_proxies").BindFunc(func(e *core.RecordEvent) error {
				hooks++
				if e.App.IsTransactional() {
					t.Error("expiry hook ran before commit")
				}
				_, err := e.App.FindRecordById("fh_proxies", e.Record.Id)
				if err != nil {
					return err
				}
				if _, err := e.App.DB().NewQuery("UPDATE fh_proxies SET bootStatus = 'offline' WHERE id = {:id}").Bind(dbx.Params{"id": e.Record.Id}).Execute(); err != nil {
					return err
				}
				return e.Next()
			})
			close(wrapped.resume)
			var got result
			select {
			case got = <-results:
			case <-time.After(5 * time.Second):
				t.Fatal("expiry save or after-success hook deadlocked")
			}
			want := 0
			if edit == "move and retarget" {
				want = 1
			}
			if got.err != nil || got.n != want || hooks != want {
				t.Fatalf("result=%+v hooks=%d want=%d", got, hooks, want)
			}
			if want == 0 {
				select {
				case report := <-reported:
					t.Fatalf("unexpected expiry report %q", report)
				default:
				}
				if edit != "delete" {
					stored, err := app.FindRecordById("fh_proxies", r.Id)
					if err != nil {
						t.Fatal(err)
					}
					if stored.GetString("status") != r.GetString("status") || stored.GetString("expiresAt") != r.GetString("expiresAt") {
						t.Fatal("expiry overwrote the concurrent edit")
					}
				}
				return
			}
			if report := <-reported; report != s2.Id+"/new/edited" {
				t.Fatalf("reported stale target/name: %s", report)
			}
			stored, err := app.FindRecordById("fh_proxies", r.Id)
			if err != nil {
				t.Fatal(err)
			}
			for _, field := range []string{"serverId", "name", "localPort", "description", "options"} {
				if stored.GetString(field) != r.GetString(field) {
					t.Errorf("expiry overwrote %s", field)
				}
			}
			if stored.GetString("status") != "disabled" || !stored.GetDateTime("expiresAt").IsZero() {
				t.Fatal("proxy was not disabled")
			}
		})
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
