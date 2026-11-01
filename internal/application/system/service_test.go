package system

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"podux/internal/testutil"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Force both callers to reach the write boundary before either can enter it.
// A pre-transaction initialized check would let both different emails succeed.
type initializationBarrierApp struct {
	core.App
	arrived atomic.Int32
	ready   chan struct{}
}

func (a *initializationBarrierApp) RunInTransaction(fn func(core.App) error) error {
	if a.arrived.Add(1) == 2 {
		close(a.ready)
	}
	<-a.ready
	return a.App.RunInTransaction(fn)
}

func TestInitializeSystemConcurrentDifferentEmails(t *testing.T) {
	app := testutil.NewApp(t)
	service := NewService(&initializationBarrierApp{App: app, ready: make(chan struct{})})
	results := make(chan error, 2)
	for _, email := range []string{"first@example.test", "second@example.test"} {
		go func() {
			results <- service.InitializeSystem(&InitializeRequest{
				Email: email, Password: "synthetic-test-password", Language: "zh",
			})
		}()
	}
	successes := 0
	for range 2 {
		select {
		case err := <-results:
			if err == nil {
				successes++
			} else if err.Error() != "system is already initialized" {
				t.Fatalf("unexpected initialization error: %v", err)
			}
		case <-time.After(10 * time.Second):
			t.Fatal("concurrent initialization did not complete")
		}
	}
	users, err := app.FindAllRecords("fh_users")
	if err != nil || successes != 1 || len(users) != 1 {
		t.Fatalf("successes=%d users=%d err=%v, want one of each", successes, len(users), err)
	}
	if initialized, err := service.CheckInitialized(); err != nil || !initialized {
		t.Fatalf("initialized=%v err=%v", initialized, err)
	}
}

func TestCheckInitializedDistinguishesMissingRecordFromDatabaseFailure(t *testing.T) {
	app := testutil.NewApp(t)
	service := NewService(app)
	if _, err := app.DB().NewQuery("DELETE FROM fh_settings").Execute(); err != nil {
		t.Fatal(err)
	}
	if initialized, err := service.CheckInitialized(); err != nil || initialized {
		t.Fatalf("missing record: initialized=%v err=%v", initialized, err)
	}
	// Keep the collection metadata, but force the settings SELECT to fail.
	if _, err := app.DB().NewQuery("DROP TABLE fh_settings").Execute(); err != nil {
		t.Fatal(err)
	}
	if initialized, err := service.CheckInitialized(); err == nil || initialized {
		t.Fatalf("database error: initialized=%v err=%v", initialized, err)
	}
	if err := service.InitializeSystem(&InitializeRequest{Email: "a@example.test", Password: "synthetic-test-password"}); err == nil {
		t.Fatal("initialized despite a settings database error")
	}
	users, err := app.FindAllRecords("fh_users")
	if err != nil || len(users) != 0 {
		t.Fatalf("users created despite database error: %d, %v", len(users), err)
	}
}

func TestGetLatestVersionCachesAndFallsBack(t *testing.T) {
	var calls atomic.Int32
	fail := atomic.Bool{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if fail.Load() {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.Write([]byte(`{"tag_name":"v0.2.0","html_url":"https://example.com/r"}`))
	}))
	defer srv.Close()

	old := latestReleaseURL
	latestReleaseURL = srv.URL
	defer func() { latestReleaseURL = old }()

	s := NewService(nil)
	for i := 0; i < 3; i++ {
		got, err := s.GetLatestVersion()
		if err != nil || got.TagName != "v0.2.0" {
			t.Fatalf("got %+v, %v", got, err)
		}
	}
	if n := calls.Load(); n != 1 {
		t.Fatalf("GitHub called %d times, want 1 (cached)", n)
	}

	// Once the cache expires, a failed refresh keeps serving the last known release.
	s.latestAt = s.latestAt.Add(-2 * latestReleaseTTL)
	fail.Store(true)
	if got, err := s.GetLatestVersion(); err != nil || got.TagName != "v0.2.0" {
		t.Fatalf("got %+v, %v; want stale release", got, err)
	}

	// With nothing cached, the error is returned.
	if _, err := NewService(nil).GetLatestVersion(); err == nil {
		t.Fatal("expected error when GitHub fails and nothing is cached")
	}
}

func TestUpdateSettingsKeepsOtherKeys(t *testing.T) {
	app := testutil.NewApp(t)
	s := NewService(app)
	if err := s.InitializeSystem(&InitializeRequest{Email: "a@example.com", Password: "12345678", Language: "zh"}); err != nil {
		t.Fatal(err)
	}

	if err := s.UpdateSettings(&UpdateSettingsRequest{General: map[string]interface{}{"latencyCheckInterval": 60}}); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetSettings()
	if err != nil {
		t.Fatal(err)
	}
	if got.General["defaultLanguage"] != "zh" || got.General["latencyCheckInterval"] != float64(60) {
		t.Fatalf("general = %v, want defaultLanguage kept and the interval updated", got.General)
	}
}

// The old implementation read outside a transaction; pause after both reads.
// The fixed implementation instead pauses at the write boundary, then each
// transaction reads the latest committed JSON before applying its own patch.
type settingsMergeBarrierApp struct{ initializationBarrierApp }

func (a *settingsMergeBarrierApp) FindRecordById(collection any, id string, filters ...func(*dbx.SelectQuery) error) (*core.Record, error) {
	r, err := a.App.FindRecordById(collection, id, filters...)
	if a.arrived.Add(1) == 2 {
		close(a.ready)
	}
	<-a.ready
	return r, err
}

func TestUpdateSettingsConcurrentPatchesKeepBothKeys(t *testing.T) {
	app := testutil.NewApp(t)
	if err := NewService(app).InitializeSystem(&InitializeRequest{Email: "a@example.test", Password: "synthetic-test-password", Language: "zh"}); err != nil {
		t.Fatal(err)
	}
	service := NewService(&settingsMergeBarrierApp{initializationBarrierApp{App: app, ready: make(chan struct{})}})
	var notifications atomic.Int32
	service.OnSettingsUpdated(func() {
		// A listener can open another write transaction only after commit.
		if err := app.RunInTransaction(func(tx core.App) error { return nil }); err != nil {
			t.Error(err)
		}
		notifications.Add(1)
	})
	results := make(chan error, 2)
	for _, patch := range []map[string]interface{}{{"latencyCheckInterval": 60}, {"locationCheckInterval": 120}} {
		go func() { results <- service.UpdateSettings(&UpdateSettingsRequest{General: patch}) }()
	}
	for range 2 {
		select {
		case err := <-results:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("settings write or listener deadlocked")
		}
	}
	settings, err := NewService(app).GetSettings()
	if err != nil {
		t.Fatal(err)
	}
	if settings.General["defaultLanguage"] != "zh" || settings.General["latencyCheckInterval"] != float64(60) || settings.General["locationCheckInterval"] != float64(120) || notifications.Load() != 2 {
		t.Fatalf("lost concurrent patch: general=%v notifications=%d", settings.General, notifications.Load())
	}
}

func TestUpdateSettingsReadFailuresDoNotWriteOrNotify(t *testing.T) {
	for _, setup := range []string{
		"DELETE FROM fh_settings",
		"UPDATE fh_settings SET general = 'invalid json'",
		"DROP TABLE fh_settings",
	} {
		t.Run(setup, func(t *testing.T) {
			app := testutil.NewApp(t)
			service := NewService(app)
			if err := service.InitializeSystem(&InitializeRequest{Email: "a@example.test", Password: "synthetic-test-password"}); err != nil {
				t.Fatal(err)
			}
			if _, err := app.DB().NewQuery(setup).Execute(); err != nil {
				t.Fatal(err)
			}
			notified := false
			service.OnSettingsUpdated(func() { notified = true })
			if err := service.UpdateSettings(&UpdateSettingsRequest{General: map[string]interface{}{"latencyCheckInterval": 60}}); err == nil {
				t.Fatal("settings read failure was ignored")
			}
			if notified {
				t.Fatal("failed update notified listeners")
			}
			if setup == "UPDATE fh_settings SET general = 'invalid json'" {
				var general string
				err := app.DB().Select("general").From("fh_settings").Where(dbx.HashExp{"id": SettingsID}).Row(&general)
				if err != nil || general != "invalid json" {
					t.Fatalf("settings overwritten after read error: %q %v", general, err)
				}
			}
		})
	}
}

func TestMonitoringIntervalsFromSavedSettings(t *testing.T) {
	app := testutil.NewApp(t)
	s := NewService(app)
	if err := s.InitializeSystem(&InitializeRequest{Email: "a@example.com", Password: "12345678"}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateSettings(&UpdateSettingsRequest{General: map[string]interface{}{
		"latencyCheckInterval": 45, "locationCheckInterval": 120,
	}}); err != nil {
		t.Fatal(err)
	}
	latency, geo := s.GetMonitoringIntervals()
	if latency != 45*time.Second || geo != 120*time.Second {
		t.Fatalf("intervals = %v, %v; want the saved 45s and 120s", latency, geo)
	}
}
