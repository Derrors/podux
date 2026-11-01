package frpc

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	proxydomain "podux/internal/domain/proxy"
	serverdomain "podux/internal/domain/server"
	"podux/internal/infrastructure/persistence"
	"podux/internal/testutil"
)

type pausedSnapshotRepo struct {
	proxydomain.Repository
	once            sync.Once
	paused, release chan struct{}
	mu              sync.Mutex
	reads           int
}

func (r *pausedSnapshotRepo) FindEnabledByServerID(id string) ([]proxydomain.Proxy, error) {
	snapshot, err := r.Repository.FindEnabledByServerID(id)
	r.mu.Lock()
	r.reads++
	r.mu.Unlock()
	r.once.Do(func() { close(r.paused); <-r.release })
	return snapshot, err
}

// Hold an accepted socket open without speaking frp, so startup does not fail
// before the test can inspect the service. No external network is needed.
func silentEndpoint(t *testing.T) (int, func()) {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go func() { defer c.Close(); <-done }()
		}
	}()
	var once sync.Once
	return l.Addr().(*net.TCPAddr).Port, func() { once.Do(func() { close(done); l.Close() }) }
}

func TestReloadDuringStartupSnapshotIsNotLost(t *testing.T) {
	app := testutil.NewApp(t)
	port, closeEndpoint := silentEndpoint(t)
	defer closeEndpoint()
	s := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "fixture", "serverAddr": "127.0.0.1", "serverPort": port, "transport": map[string]any{"tls": map[string]any{"enable": false}}})
	p := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{"name": "fixture", "serverId": s.Id, "proxyType": "tcp", "localPort": 8080, "remotePort": 6000, "status": "enabled", "bootStatus": "offline"})
	repo := &pausedSnapshotRepo{Repository: persistence.NewProxyRepository(app), paused: make(chan struct{}), release: make(chan struct{})}
	fs := NewService(app, persistence.NewServerRepository(app), repo, persistence.NewVisitorRepository(app))
	fs.RegisterHooks()
	launched := make(chan error, 1)
	go func() { launched <- fs.LaunchFrpc(&s.Id) }()
	select {
	case <-repo.paused:
	case <-time.After(3 * time.Second):
		t.Fatal("launch did not pause")
	}
	p.Set("localPort", 8081)
	if err := app.Save(p); err != nil {
		t.Fatal(err)
	}
	// The timer runs while svr is nil, after the stale snapshot was taken.
	waitFor(t, func() bool { fs.mu.Lock(); defer fs.mu.Unlock(); return len(fs.reloadTimers) == 0 })
	close(repo.release)
	if err := <-launched; err != nil {
		t.Fatal(err)
	}
	defer fs.StopAll()
	repo.mu.Lock()
	reads := repo.reads
	repo.mu.Unlock()
	if reads < 2 {
		t.Fatal("startup did not reconcile the snapshot after publishing svr")
	}
}

func TestCommonEditRequestsRestartAndManualStopWins(t *testing.T) {
	app := testutil.NewApp(t)
	s := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "fixture", "serverAddr": "127.0.0.1", "serverPort": 7000})
	fs := NewService(app, persistence.NewServerRepository(app), persistence.NewProxyRepository(app), persistence.NewVisitorRepository(app))
	fs.RegisterHooks()
	svr, cfg, hash, files, err := fs.newClient(&s.Id)
	if err != nil {
		t.Fatal(err)
	}
	defer svr.Close()
	ctx, cancel := context.WithCancel(context.Background())
	inst := &instance{svr: svr, common: cfg, sourceHash: hash, certFiles: files, cancel: cancel, stopped: make(chan struct{})}
	fs.instances[s.Id] = inst
	s.Set("auth", map[string]any{"token": "synthetic-changed-token"})
	if err := app.Save(s); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return ctx.Err() != nil })
	fs.mu.Lock()
	restart := inst.restartRequested
	fs.mu.Unlock()
	if !restart {
		t.Fatal("common edit was silently ignored")
	}
	stopped := make(chan error, 1)
	go func() { stopped <- fs.TerminateFrpc(&s.Id) }()
	waitFor(t, func() bool { fs.mu.Lock(); defer fs.mu.Unlock(); return inst.stopRequested })
	fs.destroying(s.Id, inst)
	if err := <-stopped; err != nil {
		t.Fatal(err)
	}
	if fs.IsServerRunning(s.Id) {
		t.Fatal("automatic restart defeated manual stop")
	}
}

type reentrantServerRepo struct {
	serverdomain.Repository
	fs *Service
}

func (r *reentrantServerRepo) UpdateBootStatus(id string, _ serverdomain.ServerStatus) error {
	r.fs.IsServerRunning(id)
	return r.fs.ReconcileServer(id)
}
func TestCleanupDoesNotHoldLocksAcrossStatusCallbacks(t *testing.T) {
	r := &reentrantServerRepo{}
	fs := NewService(core.NewBaseApp(core.BaseAppConfig{}), r, fakeProxyRepo{}, nil)
	r.fs = fs
	inst := newTestInstance()
	fs.instances[serverA] = inst
	done := make(chan struct{})
	go func() { fs.destroying(serverA, inst); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("status callback deadlocked lifecycle cleanup")
	}
}

func TestStopAllCancelsStartupAndAutoStart(t *testing.T) {
	fs := newTestService(&fakeServerRepo{})
	inst := &instance{stopped: make(chan struct{})}
	fs.instances[serverA] = inst
	autoDone := make(chan struct{})
	go func() { fs.AutoStartServers(); close(autoDone) }()
	stopped := make(chan struct{})
	go func() { fs.StopAll(); close(stopped) }()
	waitFor(t, func() bool { fs.mu.Lock(); defer fs.mu.Unlock(); return inst.stopRequested })
	close(inst.stopped)
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("StopAll did not finish")
	}
	select {
	case <-autoDone:
	case <-time.After(time.Second):
		t.Fatal("auto-start sleep was not cancelled")
	}
	id := serverB
	if err := fs.LaunchFrpc(&id); !errors.Is(err, ErrLaunchCancelled) {
		t.Fatalf("launch after shutdown: %v", err)
	}
}

func TestCollectionRequestsCannotWriteRuntimeStatus(t *testing.T) {
	app := testutil.NewApp(t)
	fs := NewService(app, persistence.NewServerRepository(app), persistence.NewProxyRepository(app), persistence.NewVisitorRepository(app))
	fs.RegisterHooks()
	app.Settings().RateLimits.Enabled = false
	user := testutil.SaveRecord(t, app, "fh_users", map[string]any{"email": "fixture@example.test", "password": strings.Repeat("test-only-", 3)})
	token, err := user.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	mux, err := router.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, path, body string) {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", token)
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if res.Code != 200 {
			t.Fatalf("request failed: %d", res.Code)
		}
	}
	request(http.MethodPost, "/api/collections/fh_servers/records", `{"serverName":"fixture","serverAddr":"127.0.0.1","serverPort":7000,"bootStatus":"running"}`)
	s, err := app.FindFirstRecordByData("fh_servers", "serverName", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	if s.GetString("bootStatus") != "stopped" {
		t.Fatal("client selected initial runtime status")
	}
	// Update after the API's record read but before SQL persistence. Restoring the
	// old value without IgnoreUnchangedFields would overwrite this running status.
	app.OnRecordUpdateRequest("fh_servers").BindFunc(func(e *core.RecordRequestEvent) error {
		_, err := e.App.DB().Update("fh_servers", dbx.Params{"bootStatus": "running"}, dbx.HashExp{"id": e.Record.Id}).Execute()
		if err != nil {
			return err
		}
		return e.Next()
	})
	request(http.MethodPatch, "/api/collections/fh_servers/records/"+s.Id, `{"description":"updated","bootStatus":"stopped"}`)
	s, err = app.FindRecordById("fh_servers", s.Id)
	if err != nil {
		t.Fatal(err)
	}
	if s.GetString("bootStatus") != "running" || s.GetString("description") != "updated" {
		t.Fatal("stale configuration request overwrote the runtime projection")
	}
}
