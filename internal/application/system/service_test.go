package system

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
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
