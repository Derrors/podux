package proxy

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"podux/internal/application/importer"
	"podux/internal/testutil"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/hook"
)

func conflictTestFields(collection, serverID, name string) map[string]any {
	fields := map[string]any{"name": name, "serverId": serverID, "status": "enabled"}
	if collection == "fh_proxies" {
		fields["proxyType"], fields["localPort"], fields["remotePort"], fields["bootStatus"] = "tcp", 22, 6000, "offline"
	} else {
		fields["visitorType"], fields["serverName"], fields["bindPort"] = "stcp", "target", 6000
	}
	return fields
}

func conflictTestRouter(t *testing.T, app core.App) (http.Handler, string) {
	t.Helper()
	app.Settings().RateLimits.Enabled = false
	user := testutil.SaveRecord(t, app, "fh_users", map[string]any{"email": "admin@example.test", "password": "synthetic-test-password"})
	token, err := user.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	r, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	return mux, token
}

func collectionRequest(h http.Handler, token, method, path string, body []byte) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(string(body)))
	req.Header.Set("Authorization", token)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	return res
}

// Both paths exercise actual persistence (and real collection API middleware),
// not just the conflict predicate. The execute barrier forces the old race:
// without a write transaction, both validations pass before either insert/update.
func TestConcurrentConflictingSaves(t *testing.T) {
	for _, viaRouter := range []bool{false, true} {
		for _, collection := range []string{"fh_proxies", "fh_visitors"} {
			for _, update := range []bool{false, true} {
				t.Run(fmt.Sprintf("router=%v/%s/update=%v", viaRouter, collection, update), func(t *testing.T) {
					app := testutil.NewApp(t)
					RegisterConflictChecks(app)
					s := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "a", "serverAddr": "1.1.1.1", "serverPort": 7000})
					var handler http.Handler
					var token string
					if viaRouter {
						handler, token = conflictTestRouter(t, app)
					}
					records := make([]*core.Record, 2)
					for i := range records {
						records[i] = newRecord(t, app, collection, conflictTestFields(collection, s.Id, fmt.Sprintf("candidate%d", i)))
						if update {
							records[i].Set("status", "disabled")
							if err := app.Save(records[i]); err != nil {
								t.Fatal(err)
							}
							records[i].Set("status", "enabled")
						}
					}

					var started, unsafeWrites, successes atomic.Int32
					ready, unsafeReady := make(chan struct{}), make(chan struct{})
					start := &hook.Handler[*core.RecordEvent]{Priority: -101, Func: func(e *core.RecordEvent) error {
						if started.Add(1) == 2 {
							close(ready)
						}
						select {
						case <-ready:
							return e.Next()
						case <-time.After(5 * time.Second):
							return fmt.Errorf("save entry barrier timed out")
						}
					}}
					beforeSQL := func(e *core.RecordEvent) error {
						if !e.App.IsTransactional() {
							if unsafeWrites.Add(1) == 2 {
								close(unsafeReady)
							}
							select {
							case <-unsafeReady:
							case <-time.After(5 * time.Second):
								return fmt.Errorf("unserialized execute barrier timed out")
							}
						}
						return e.Next()
					}
					afterSuccess := func(e *core.RecordEvent) error {
						if e.App.IsTransactional() {
							return fmt.Errorf("after-success received a transaction app")
						}
						// Verify the hook can read committed data and acquire the write
						// connection again (a mutex retained until after hooks deadlocks).
						if _, err := e.App.FindRecordById(collection, e.Record.Id); err != nil {
							return err
						}
						if _, err := e.App.DB().Update(collection, dbx.Params{"description": "after commit"}, dbx.HashExp{"id": e.Record.Id}).Execute(); err != nil {
							return err
						}
						successes.Add(1)
						return e.Next()
					}
					if update {
						app.OnRecordUpdate(collection).Bind(start)
						app.OnRecordUpdateExecute(collection).BindFunc(beforeSQL)
						app.OnRecordAfterUpdateSuccess(collection).BindFunc(afterSuccess)
					} else {
						app.OnRecordCreate(collection).Bind(start)
						app.OnRecordCreateExecute(collection).BindFunc(beforeSQL)
						app.OnRecordAfterCreateSuccess(collection).BindFunc(afterSuccess)
					}
					results := make(chan error, 2)
					for _, record := range records {
						go func() {
							if !viaRouter {
								results <- app.Save(record)
								return
							}
							method, path := http.MethodPost, "/api/collections/"+collection+"/records"
							body := conflictTestFields(collection, s.Id, record.GetString("name"))
							if update {
								method, path, body = http.MethodPatch, path+"/"+record.Id, map[string]any{"status": "enabled"}
							}
							encoded, err := json.Marshal(body)
							if err != nil {
								results <- err
								return
							}
							res := collectionRequest(handler, token, method, path, encoded)
							if res.Code == http.StatusOK {
								results <- nil
								return
							}
							code := CodePortConflict
							if collection == "fh_visitors" {
								code = CodeBindConflict
							}
							if res.Code != http.StatusBadRequest || !strings.Contains(res.Body.String(), code) {
								t.Errorf("unexpected HTTP error: %d %s", res.Code, res.Body.String())
							}
							results <- fmt.Errorf("%s", res.Body.String())
						}()
					}
					ok := 0
					for range 2 {
						select {
						case err := <-results:
							if err == nil {
								ok++
							} else if !viaRouter {
								want := "remotePort"
								if collection == "fh_visitors" {
									want = "bindPort"
								}
								if field := conflictField(err); field != want {
									t.Errorf("save error=%v, want %s conflict", err, want)
								}
							}
						case <-time.After(10 * time.Second):
							t.Fatal("concurrent saves did not complete")
						}
					}
					enabled, err := app.FindAllRecords(collection, dbx.HashExp{"status": "enabled"})
					if err != nil || ok != 1 || len(enabled) != 1 || successes.Load() != 1 || unsafeWrites.Load() != 0 {
						t.Fatalf("successful saves=%d enabled=%d after-hooks=%d unserialized=%d err=%v", ok, len(enabled), successes.Load(), unsafeWrites.Load(), err)
					}
				})
			}
		}
	}
}

func TestConflictChecksNestedTransactions(t *testing.T) {
	for _, collection := range []string{"fh_proxies", "fh_visitors"} {
		t.Run(collection, func(t *testing.T) {
			app := testutil.NewApp(t)
			RegisterConflictChecks(app)
			s := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "a", "serverAddr": "1.1.1.1", "serverPort": 7000})
			var hooks atomic.Int32
			app.OnRecordAfterCreateSuccess(collection).BindFunc(func(e *core.RecordEvent) error {
				if e.App.IsTransactional() {
					return fmt.Errorf("after-success fired before commit")
				}
				hooks.Add(1)
				return e.Next()
			})
			for _, conflict := range []bool{true, false} {
				err := app.RunInTransaction(func(tx core.App) error {
					return tx.RunInTransaction(func(nested core.App) error {
						for i := range 2 {
							r := newRecord(t, nested, collection, conflictTestFields(collection, s.Id, fmt.Sprintf("record%d", i)))
							if !conflict && i == 1 {
								if collection == "fh_proxies" {
									r.Set("remotePort", 6001)
								} else {
									r.Set("bindPort", 6001)
								}
							}
							if err := nested.Save(r); err != nil {
								return err
							}
							if hooks.Load() != 0 {
								t.Error("success hook fired before outer commit")
							}
						}
						return nil
					})
				})
				if (err != nil) != conflict {
					t.Fatalf("conflict=%v err=%v", conflict, err)
				}
				records, err := app.FindAllRecords(collection)
				want := 2
				if conflict {
					want = 0
				}
				if err != nil || len(records) != want || int(hooks.Load()) != want {
					t.Fatalf("records=%d hooks=%d err=%v want=%d", len(records), hooks.Load(), err, want)
				}
			}
		})
	}
}

func TestConflictChecksImportTransaction(t *testing.T) {
	for _, conflictIn := range []string{"proxy", "visitor", "none"} {
		t.Run(conflictIn, func(t *testing.T) {
			app := testutil.NewApp(t)
			RegisterConflictChecks(app)
			secondProxyPort, secondVisitorPort := 6001, 7001
			if conflictIn == "proxy" {
				secondProxyPort = 6000
			}
			if conflictIn == "visitor" {
				secondVisitorPort = 7000
			}
			content := fmt.Sprintf(`serverAddr = "1.1.1.1"
serverPort = 7000
[[proxies]]
name = "p1"
type = "tcp"
localPort = 22
remotePort = 6000
[[proxies]]
name = "p2"
type = "tcp"
localPort = 22
remotePort = %d
[[visitors]]
name = "v1"
type = "stcp"
serverName = "target"
bindPort = 7000
[[visitors]]
name = "v2"
type = "xtcp"
serverName = "target"
bindPort = %d
`, secondProxyPort, secondVisitorPort)
			var hooks atomic.Int32
			app.OnRecordAfterCreateSuccess("fh_servers", "fh_proxies", "fh_visitors").BindFunc(func(e *core.RecordEvent) error {
				if e.App.IsTransactional() {
					return fmt.Errorf("import success hook ran before commit")
				}
				hooks.Add(1)
				return e.Next()
			})
			result, err := importer.NewService(app).ExecuteImport(&importer.ExecuteImportRequest{
				TomlContent: content, ServerName: "import", ImportServer: true, ImportVisitors: true,
				Proxies: []importer.ProxyImportOption{{Name: "p1", Import: true}, {Name: "p2", Import: true}},
			})
			if conflictIn != "none" {
				field := "remotePort"
				if conflictIn == "visitor" {
					field = "bindPort"
				}
				if conflictField(err) != field {
					t.Fatalf("import error=%v, want %s", err, field)
				}
				for _, collection := range []string{"fh_servers", "fh_proxies", "fh_visitors"} {
					records, err := app.FindAllRecords(collection)
					if err != nil || len(records) != 0 {
						t.Fatalf("import did not roll back %s: %d %v", collection, len(records), err)
					}
				}
				if hooks.Load() != 0 {
					t.Fatal("rolled-back import fired success hooks")
				}
			} else if err != nil || result.ProxiesImported != 2 || result.VisitorsImported != 2 || hooks.Load() != 5 {
				t.Fatalf("import result=%+v hooks=%d err=%v", result, hooks.Load(), err)
			}
		})
	}
}

func TestCollectionAPIBatchConflictRollsBack(t *testing.T) {
	app := testutil.NewApp(t)
	RegisterConflictChecks(app)
	app.Settings().Batch.Enabled = true
	app.Settings().Batch.MaxRequests = 10
	app.Settings().Batch.Timeout = 3
	s := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "a", "serverAddr": "1.1.1.1", "serverPort": 7000})
	handler, token := conflictTestRouter(t, app)
	var hooks atomic.Int32
	app.OnRecordAfterCreateSuccess("fh_proxies", "fh_visitors").BindFunc(func(e *core.RecordEvent) error {
		if e.App.IsTransactional() {
			return fmt.Errorf("batch after-success ran before commit")
		}
		hooks.Add(1)
		return e.Next()
	})
	for _, collection := range []string{"fh_proxies", "fh_visitors"} {
		for _, conflict := range []bool{true, false} {
			requests := []map[string]any{}
			for i := range 2 {
				body := conflictTestFields(collection, s.Id, fmt.Sprintf("batch%d", i))
				if !conflict && i == 1 {
					if collection == "fh_proxies" {
						body["remotePort"] = 6001
					} else {
						body["bindPort"] = 6001
					}
				}
				requests = append(requests, map[string]any{"method": http.MethodPost, "url": "/api/collections/" + collection + "/records", "body": body})
			}
			encoded, err := json.Marshal(map[string]any{"requests": requests})
			if err != nil {
				t.Fatal(err)
			}
			res := collectionRequest(handler, token, http.MethodPost, "/api/batch", encoded)
			wantStatus, wantRows := http.StatusOK, 2
			if conflict {
				wantStatus, wantRows = http.StatusBadRequest, 0
			}
			if res.Code != wantStatus {
				t.Fatalf("batch response=%d %s", res.Code, res.Body.String())
			}
			if conflict && !strings.Contains(res.Body.String(), "validation_") {
				t.Fatalf("batch failed for another reason: %s", res.Body.String())
			}
			records, err := app.FindAllRecords(collection)
			if err != nil || len(records) != wantRows || hooks.Swap(0) != int32(wantRows) {
				t.Fatalf("batch records=%d err=%v want=%d", len(records), err, wantRows)
			}
		}
	}
}
