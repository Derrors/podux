package httphandler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"podux/internal/application/dashboard"
	"podux/internal/application/frpc"
	"podux/internal/application/importer"
	"podux/internal/application/monitoring"
	"podux/internal/application/notify"
	"podux/internal/application/proxy"
	"podux/internal/application/server"
	"podux/internal/application/system"
	"podux/internal/application/version"
	"podux/internal/infrastructure/persistence"
	"podux/internal/testutil"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// newTestRouter registers every custom route on PocketBase's own router, so requests
// go through the same middlewares (including auth token loading) as in production.
func newTestRouter(t *testing.T) (core.App, http.Handler) {
	t.Helper()
	app := testutil.NewApp(t)

	serverRepo := persistence.NewServerRepository(app)
	proxyRepo := persistence.NewProxyRepository(app)
	metricsService := monitoring.NewMetricsService(app)
	dashboardService := dashboard.NewService(app, server.NewService(app, serverRepo), proxy.NewService(app, proxyRepo), metricsService)

	r, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	e := &core.ServeEvent{App: app, Router: r}
	NewFrpcHandler(app, frpc.NewService(app, serverRepo, proxyRepo, persistence.NewVisitorRepository(app))).RegisterHandlers(e)
	NewVersionHandler(app, version.NewService(app)).RegisterHandlers(e)
	NewDashboardHandler(dashboardService).RegisterHandlers(e)
	NewSystemHandler(app, system.NewService(app)).RegisterHandlers(e)
	NewImportHandler(app, importer.NewService(app)).RegisterHandlers(e)
	NewServerHandler(app, metricsService).RegisterHandlers(e)
	NewNotifyHandler(notify.NewService(app)).RegisterHandlers(e)

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	return app, mux
}

// userToken creates a Podux user and returns an auth token for it.
func userToken(t *testing.T, app core.App) string {
	t.Helper()
	users, err := app.FindCollectionByNameOrId("fh_users")
	if err != nil {
		t.Fatal(err)
	}
	u := core.NewRecord(users)
	u.SetEmail("admin@example.com")
	u.SetPassword("12345678")
	if err := app.Save(u); err != nil {
		t.Fatal(err)
	}
	token, err := u.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func do(t *testing.T, h http.Handler, method, url, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

var protectedRoutes = []struct{ method, url string }{
	{http.MethodGet, "/api/frp/version"},
	{http.MethodGet, "/api/system/settings"},
	{http.MethodPut, "/api/system/settings"},
	{http.MethodGet, "/api/system/version"},
	{http.MethodGet, "/api/system/latest-version"},
	{http.MethodGet, "/api/servers"},
	{http.MethodGet, "/api/servers/probe-history?serverId=abc"},
	{http.MethodGet, "/api/servers/options"},
	{http.MethodPost, "/api/import/preview"},
	{http.MethodPost, "/api/import/execute"},
	{http.MethodGet, "/api/dashboard/topology"},
	{http.MethodGet, "/api/dashboard/stats"},
	{http.MethodPost, "/api/frpc/launch"},
	{http.MethodGet, "/api/frpc/logs/stream?id=aaaaaaaaaaaaaaa"},
	{http.MethodPost, "/api/frpc/terminate"},
	{http.MethodPost, "/api/frpc/reload"},
	{http.MethodGet, "/api/frpc/export?id=aaaaaaaaaaaaaaa"},
	{http.MethodGet, "/api/notifications"},
	{http.MethodPut, "/api/notifications"},
	{http.MethodPost, "/api/notifications/test"},
}

func TestProtectedRoutesRequireAuth(t *testing.T) {
	_, h := newTestRouter(t)

	for _, route := range protectedRoutes {
		for name, token := range map[string]string{"no token": "", "bad token": "not-a-jwt"} {
			rec := do(t, h, route.method, route.url, token, "{}")
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("%s %s with %s: status %d, want 401", route.method, route.url, name, rec.Code)
			}
		}
	}
}

func TestLogStreamIgnoresQueryToken(t *testing.T) {
	app, h := newTestRouter(t)
	token := userToken(t, app)

	rec := do(t, h, http.MethodGet, "/api/frpc/logs/stream?id=aaaaaaaaaaaaaaa&token="+token, "", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401: tokens are only accepted in the Authorization header", rec.Code)
	}
}

func TestInitializeOnlyOnce(t *testing.T) {
	_, h := newTestRouter(t)

	rec := do(t, h, http.MethodGet, "/api/system/initialized", "", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"initialized":false`) {
		t.Fatalf("initialized before setup: %d %s", rec.Code, rec.Body)
	}

	body := `{"email":"admin@example.com","password":"12345678","language":"zh"}`
	if rec := do(t, h, http.MethodPost, "/api/system/initialize", "", body); rec.Code != http.StatusOK {
		t.Fatalf("first initialize: %d %s", rec.Code, rec.Body)
	}

	rec = do(t, h, http.MethodGet, "/api/system/initialized", "", "")
	if !strings.Contains(rec.Body.String(), `"initialized":true`) {
		t.Fatalf("initialized after setup: %s", rec.Body)
	}

	other := `{"email":"attacker@example.com","password":"12345678"}`
	if rec := do(t, h, http.MethodPost, "/api/system/initialize", "", other); rec.Code != http.StatusForbidden {
		t.Fatalf("second initialize: status %d, want 403", rec.Code)
	}
}

func TestServerListOmitsCredentials(t *testing.T) {
	app, h := newTestRouter(t)
	token := userToken(t, app)

	testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "home", "serverAddr": "frps.example.com", "serverPort": 7000,
		"auth":      map[string]any{"method": "token", "token": "s3cret-token"},
		"transport": map[string]any{"tls": map[string]any{"keyFile": "PRIVATE-KEY-PEM"}},
	})

	for _, url := range []string{"/api/servers", "/api/servers/options"} {
		rec := do(t, h, http.MethodGet, url, token, "")
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d: %s", url, rec.Code, rec.Body)
		}
		body := rec.Body.String()
		if !strings.Contains(body, `"serverName":"home"`) {
			t.Errorf("%s: server missing from %s", url, body)
		}
		for _, secret := range []string{"s3cret-token", "PRIVATE-KEY-PEM"} {
			if strings.Contains(body, secret) {
				t.Errorf("%s leaks %q: %s", url, secret, body)
			}
		}
	}
}

func TestServerListSearchAndPaging(t *testing.T) {
	app, h := newTestRouter(t)
	token := userToken(t, app)

	for _, name := range []string{"alpha", "beta", "100%"} {
		testutil.SaveRecord(t, app, "fh_servers", map[string]any{
			"serverName": name, "serverAddr": "127.0.0.1", "serverPort": 7000,
		})
	}

	var page serverListResponse
	rec := do(t, h, http.MethodGet, "/api/servers?perPage=2", token, "")
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if page.TotalItems != 3 || page.TotalPages != 2 || len(page.Items) != 2 {
		t.Fatalf("paging: total %d, pages %d, items %d", page.TotalItems, page.TotalPages, len(page.Items))
	}

	// "%" must match literally, not as a LIKE wildcard, in both the count and the page.
	rec = do(t, h, http.MethodGet, "/api/servers?search=%25", token, "")
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if page.TotalItems != 1 || len(page.Items) != 1 || page.Items[0].ServerName != "100%" {
		t.Fatalf("search %%: total %d, items %+v", page.TotalItems, page.Items)
	}
}

func TestFrpcRoutesValidateID(t *testing.T) {
	app, h := newTestRouter(t)
	token := userToken(t, app)

	for _, url := range []string{"/api/frpc/launch", "/api/frpc/terminate", "/api/frpc/reload"} {
		for _, body := range []string{`{}`, `{"id":"../../etc/passwd"}`, `not json`} {
			if rec := do(t, h, http.MethodPost, url, token, body); rec.Code != http.StatusBadRequest {
				t.Errorf("POST %s %s: status %d, want 400", url, body, rec.Code)
			}
		}
	}
	if rec := do(t, h, http.MethodGet, "/api/frpc/logs/stream?id=bad", token, ""); rec.Code != http.StatusBadRequest {
		t.Errorf("log stream with bad id: status %d, want 400", rec.Code)
	}

	// Stopping or reloading a server that isn't running is a no-op, not an error.
	for _, url := range []string{"/api/frpc/terminate", "/api/frpc/reload"} {
		if rec := do(t, h, http.MethodPost, url, token, `{"id":"aaaaaaaaaaaaaaa"}`); rec.Code != http.StatusOK {
			t.Errorf("POST %s for a stopped server: status %d, want 200", url, rec.Code)
		}
	}
}

func TestExportToml(t *testing.T) {
	app, h := newTestRouter(t)
	token := userToken(t, app)

	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "home", "serverAddr": "frps.example.com", "serverPort": 7000,
		"auth": map[string]any{"method": "token", "token": "s3cret-token"},
	})

	rec := do(t, h, http.MethodGet, "/api/frpc/export?id="+server.Id, token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, "frpc-"+server.Id+".toml") {
		t.Errorf("Content-Disposition = %q", cd)
	}
	if body := rec.Body.String(); strings.Contains(body, "s3cret-token") || !strings.Contains(body, "frps.example.com") {
		t.Errorf("default export must redact the token:\n%s", body)
	}

	rec = do(t, h, http.MethodGet, "/api/frpc/export?secrets=1&id="+server.Id, token, "")
	if !strings.Contains(rec.Body.String(), "s3cret-token") {
		t.Errorf("secrets=1 export lacks the token:\n%s", rec.Body)
	}

	if rec := do(t, h, http.MethodGet, "/api/frpc/export?id=zzzzzzzzzzzzzzz", token, ""); rec.Code != http.StatusNotFound {
		t.Errorf("unknown server: status %d, want 404", rec.Code)
	}
	if rec := do(t, h, http.MethodGet, "/api/frpc/export?id=../x", token, ""); rec.Code != http.StatusBadRequest {
		t.Errorf("bad id: status %d, want 400", rec.Code)
	}
}

func TestNotificationSettings(t *testing.T) {
	app, h := newTestRouter(t)
	token := userToken(t, app)
	if rec := do(t, h, http.MethodPost, "/api/system/initialize", "", `{"email":"x@example.com","password":"12345678"}`); rec.Code != http.StatusOK {
		t.Fatalf("initialize: %d %s", rec.Code, rec.Body)
	}

	rec := do(t, h, http.MethodGet, "/api/notifications", token, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"enabled":false`) {
		t.Fatalf("defaults: %d %s", rec.Code, rec.Body)
	}

	bad := `{"enabled":true,"webhook":{"enabled":true,"url":"not a url"}}`
	if rec := do(t, h, http.MethodPut, "/api/notifications", token, bad); rec.Code != http.StatusBadRequest {
		t.Errorf("invalid settings: status %d, want 400", rec.Code)
	}

	good := `{"enabled":true,"latencyThresholdMs":300,"events":{"proxyDown":true},"bark":{"enabled":true,"deviceKey":"k"}}`
	if rec := do(t, h, http.MethodPut, "/api/notifications", token, good); rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body)
	}
	rec = do(t, h, http.MethodGet, "/api/notifications", token, "")
	for _, want := range []string{`"enabled":true`, `"latencyThresholdMs":300`, `"deviceKey":"k"`} {
		if !strings.Contains(rec.Body.String(), want) {
			t.Errorf("saved settings lack %s: %s", want, rec.Body)
		}
	}

	// Nothing enabled to test: an empty result, not an error.
	if rec := do(t, h, http.MethodPost, "/api/notifications/test", token, `{}`); rec.Code != http.StatusOK || rec.Body.String() != "[]" {
		t.Errorf("empty test: %d %s", rec.Code, rec.Body)
	}
}
