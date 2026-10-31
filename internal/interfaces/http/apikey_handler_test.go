package httphandler

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"podux/internal/testutil"
)

// createKey creates an API key through the API and returns its token.
func createKey(t *testing.T, h http.Handler, session, scope string) (id, token string) {
	t.Helper()
	rec := do(t, h, http.MethodPost, "/api/api-keys", session, `{"name":"grafana","scope":"`+scope+`"}`)
	var out struct {
		Key   struct{ ID, Prefix, Scope string }
		Token string
	}
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &out) != nil {
		t.Fatalf("create key: %d %s", rec.Code, rec.Body)
	}
	if !strings.HasPrefix(out.Token, "pdx_") || !strings.HasPrefix(out.Token, out.Key.Prefix) || out.Key.Scope != scope {
		t.Fatalf("create key: unexpected %+v", out)
	}
	return out.Key.ID, out.Token
}

func TestAPIKeyLifecycle(t *testing.T) {
	app, h := newTestRouter(t)
	session := userToken(t, app)

	if rec := do(t, h, http.MethodPost, "/api/api-keys", session, `{"name":"x","scope":"admin"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("bad scope: %d", rec.Code)
	}
	if rec := do(t, h, http.MethodPost, "/api/api-keys", session, `{"name":"  ","scope":"read"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("blank name: %d", rec.Code)
	}

	id, token := createKey(t, h, session, "read")
	rec := do(t, h, http.MethodGet, "/api/api-keys", session, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"name":"grafana"`) {
		t.Fatalf("list: %d %s", rec.Code, rec.Body)
	}
	// Only the hash is stored, and neither it nor the token is listed.
	if strings.Contains(rec.Body.String(), token) || strings.Contains(rec.Body.String(), "keyHash") {
		t.Errorf("list leaks the key: %s", rec.Body)
	}
	stored, err := app.FindRecordById("fh_api_keys", id)
	if err != nil || stored.GetString("keyHash") == token || len(stored.GetString("keyHash")) != 64 {
		t.Errorf("stored key: %v %q", err, stored.GetString("keyHash"))
	}

	if rec := do(t, h, http.MethodGet, "/api/metrics", "Bearer "+token, ""); rec.Code != http.StatusOK {
		t.Errorf("metrics with key: %d %s", rec.Code, rec.Body)
	}
	if rec := do(t, h, http.MethodGet, "/api/api-keys", "Bearer "+token, ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("a key must not manage keys: %d", rec.Code)
	}

	if rec := do(t, h, http.MethodDelete, "/api/api-keys/"+id, session, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body)
	}
	if rec := do(t, h, http.MethodDelete, "/api/api-keys/"+id, session, ""); rec.Code != http.StatusNotFound {
		t.Errorf("delete again: %d", rec.Code)
	}
	if rec := do(t, h, http.MethodGet, "/api/metrics", "Bearer "+token, ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("deleted key still works: %d", rec.Code)
	}
}

func TestAPIKeyScopes(t *testing.T) {
	app, h := newTestRouter(t)
	session := userToken(t, app)
	_, read := createKey(t, h, session, "read")
	_, write := createKey(t, h, session, "write")
	testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "s", "serverAddr": "1.1.1.1", "serverPort": 7000,
		"auth": map[string]any{"method": "token", "token": "frps-secret"},
	})

	for _, url := range []string{"/api/metrics", "/api/dashboard/stats", "/api/proxies/status"} {
		for name, key := range map[string]string{"read": read, "write": write} {
			if rec := do(t, h, http.MethodGet, url, "Bearer "+key, ""); rec.Code != http.StatusOK {
				t.Errorf("%s key on %s: %d %s", name, url, rec.Code, rec.Body)
			}
		}
	}

	writeRoutes := []struct{ method, url, body string }{
		{http.MethodPost, "/api/frpc/launch", "{}"},
		{http.MethodPost, "/api/frpc/terminate", "{}"},
		{http.MethodPost, "/api/frpc/reload", "{}"},
		{http.MethodPost, "/api/proxies/batch", "{}"},
	}
	for _, r := range writeRoutes {
		if rec := do(t, h, r.method, r.url, "Bearer "+read, r.body); rec.Code != http.StatusForbidden {
			t.Errorf("read key on %s: %d, want 403", r.url, rec.Code)
		}
		// Past auth, the empty body fails validation.
		if rec := do(t, h, r.method, r.url, "Bearer "+write, r.body); rec.Code != http.StatusBadRequest {
			t.Errorf("write key on %s: %d %s, want 400", r.url, rec.Code, rec.Body)
		}
	}

	// Everything else treats a key as a guest, even a write key.
	for _, url := range []string{"/api/system/settings", "/api/notifications", "/api/system/backups", "/api/servers"} {
		if rec := do(t, h, http.MethodGet, url, "Bearer "+write, ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("write key on %s: %d, want 401", url, rec.Code)
		}
	}
	rec := do(t, h, http.MethodGet, "/api/collections/fh_servers/records", "Bearer "+write, "")
	if strings.Contains(rec.Body.String(), "frps-secret") || strings.Contains(rec.Body.String(), `"serverName"`) {
		t.Errorf("collection API exposed servers to a key: %d %s", rec.Code, rec.Body)
	}

	if rec := do(t, h, http.MethodGet, "/api/metrics", "Bearer pdx_not-a-real-key", ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("unknown key: %d", rec.Code)
	}
}

func TestMetricsOutput(t *testing.T) {
	app, h := newTestRouter(t)
	session := userToken(t, app)
	s := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": `home "frps"`, "serverAddr": "1.1.1.1", "serverPort": 7000, "bootStatus": "running",
	})
	testutil.SaveRecord(t, app, "fh_proxies", map[string]any{
		"name": "ssh", "proxyType": "tcp", "serverId": s.Id, "localPort": 22, "remotePort": 6022,
		"status": "enabled", "bootStatus": "online",
	})

	rec := do(t, h, http.MethodGet, "/api/metrics", session, "")
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/plain; version=0.0.4") {
		t.Fatalf("metrics: %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	body := rec.Body.String()
	for _, want := range []string{
		"# TYPE podux_info gauge\npodux_info{version=",
		`podux_server_running{server_id="` + s.Id + `",server="home \"frps\""} 1`,
		`podux_proxy_online{proxy_id=`,
		`proxy="ssh",type="tcp",server_id="` + s.Id + `",server="home \"frps\""} 1`,
		`podux_proxy_enabled{`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("metrics missing %q in:\n%s", want, body)
		}
	}
	// No dashboard configured and nothing probed yet: those families are left out.
	for _, absent := range []string{"podux_proxy_today_traffic_in_bytes", "podux_proxy_reachable", "podux_server_latency_milliseconds"} {
		if strings.Contains(body, absent) {
			t.Errorf("metrics should not include %s yet:\n%s", absent, body)
		}
	}
}
