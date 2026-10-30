package frpc

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"podux/internal/infrastructure/persistence"
	"podux/internal/testutil"

	"github.com/pocketbase/dbx"
)

// TestStopDuringLaunchCancelsIt stops a server while LaunchFrpc is still building its
// config (paused on the proxies query), as deleting the server during auto-start does.
func TestStopDuringLaunchCancelsIt(t *testing.T) {
	app := testutil.NewApp(t)
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{
		"serverName": "s", "serverAddr": "127.0.0.1", "serverPort": 7000, "bootStatus": "stopped",
		"transport": map[string]any{"tls": map[string]any{"enable": false}},
	})
	fs := NewService(app, persistence.NewServerRepository(app), persistence.NewProxyRepository(app), persistence.NewVisitorRepository(app))
	id := server.Id

	paused, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	hook := func(_ context.Context, _ time.Duration, sql string, _ *sql.Rows, _ error) {
		if strings.Contains(sql, "fh_proxies") {
			once.Do(func() {
				close(paused)
				<-release
			})
		}
	}
	for _, b := range []dbx.Builder{app.ConcurrentDB(), app.NonconcurrentDB()} {
		b.(*dbx.DB).QueryLogFunc = hook
	}

	launched := make(chan error, 1)
	go func() { launched <- fs.LaunchFrpc(&id) }()
	select {
	case <-paused:
	case <-time.After(5 * time.Second):
		t.Fatal("LaunchFrpc never queried the proxies")
	}

	terminated := make(chan error, 1)
	go func() { terminated <- fs.TerminateFrpc(&id) }()
	waitFor(t, func() bool {
		fs.mu.Lock()
		defer fs.mu.Unlock()
		return fs.instances[id] != nil && fs.instances[id].stopRequested
	})
	close(release)

	if err := <-launched; !errors.Is(err, ErrLaunchCancelled) {
		t.Fatalf("LaunchFrpc = %v, want ErrLaunchCancelled", err)
	}
	if err := <-terminated; err != nil {
		t.Fatalf("TerminateFrpc = %v, want nil", err)
	}
	if fs.IsServerRunning(id) {
		t.Fatal("server still registered as running after a cancelled launch")
	}
}
