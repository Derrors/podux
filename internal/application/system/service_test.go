package system

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"podux/internal/testutil"
)

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
