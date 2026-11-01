package httphandler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"podux/internal/application/backup"
	"podux/internal/testutil"
)

func TestRestoreStatusDoesNotConfuseHealthyWithSuccess(t *testing.T) {
	app := testutil.NewApp(t)
	s := backup.NewService(app)
	t.Cleanup(s.Stop)
	r, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	NewBackupHandler(app, s).RegisterHandlers(&core.ServeEvent{App: app, Router: r})
	h, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	token := userToken(t, app)
	created := do(t, h, http.MethodPost, "/api/system/backups", token, "")
	var file struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &file); err != nil || file.Name == "" {
		t.Fatalf("create: %d", created.Code)
	}
	app.OnBackupRestore().BindFunc(func(e *core.BackupEvent) error { return errors.New("synthetic failure") })
	accepted := do(t, h, http.MethodPost, "/api/system/backups/"+file.Name+"/restore", token, "")
	var job backup.RestoreJob
	if err := json.Unmarshal(accepted.Body.Bytes(), &job); err != nil || accepted.Code != 202 {
		t.Fatalf("accept: %d", accepted.Code)
	}
	status := func(id string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/system/backups/restore-status", nil)
		req.Header.Set("X-Podux-Restore-ID", id)
		res := httptest.NewRecorder()
		h.ServeHTTP(res, req)
		return res
	}
	if res := status(""); res.Code != 404 {
		t.Fatalf("missing capability: %d", res.Code)
	}
	if res := status(strings.Repeat("0", 64)); res.Code != 404 {
		t.Fatalf("wrong capability: %d", res.Code)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		res := status(job.ID) // deliberately no login: restored users may differ
		if res.Code != 200 || res.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("status: %d", res.Code)
		}
		var current backup.RestoreJob
		if err := json.Unmarshal(res.Body.Bytes(), &current); err != nil {
			t.Fatal(err)
		}
		if current.State == "succeeded" {
			t.Fatal("false success")
		}
		if current.State == "failed" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("failure result missing")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if res := do(t, h, http.MethodGet, "/api/health", "", ""); res.Code != 200 {
		t.Fatalf("old process health: %d", res.Code)
	}
}
