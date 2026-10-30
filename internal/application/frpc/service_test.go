package frpc

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	proxydomain "podux/internal/domain/proxy"
	serverdomain "podux/internal/domain/server"

	"github.com/pocketbase/pocketbase/core"
)

type fakeServerRepo struct {
	serverdomain.Repository
	mu       sync.Mutex
	statuses []serverdomain.ServerStatus
}

func (r *fakeServerRepo) UpdateBootStatus(_ string, status serverdomain.ServerStatus) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.statuses = append(r.statuses, status)
	return nil
}

type fakeProxyRepo struct {
	proxydomain.Repository
}

func (fakeProxyRepo) UpdateBootStatusByServerID(string, proxydomain.ProxyBootStatus) error {
	return nil
}

func newTestService(serverRepo *fakeServerRepo) *Service {
	return NewService(core.NewBaseApp(core.BaseAppConfig{}), serverRepo, fakeProxyRepo{}, nil)
}

func newTestInstance() *instance {
	_, cancel := context.WithCancel(context.Background())
	return &instance{cancel: cancel, stopped: make(chan struct{})}
}

func TestLaunchRejectsRunningServer(t *testing.T) {
	fs := newTestService(&fakeServerRepo{})
	id := serverA
	fs.instances[id] = newTestInstance()

	if err := fs.LaunchFrpc(&id); !errors.Is(err, ErrAlreadyRunning) {
		t.Fatalf("got %v, want ErrAlreadyRunning", err)
	}
}

func TestDestroyingLeavesNewerInstanceAlone(t *testing.T) {
	repo := &fakeServerRepo{}
	fs := newTestService(repo)
	old, current := newTestInstance(), newTestInstance()
	fs.instances[serverA] = current

	// The old instance exits after a newer one has been launched.
	fs.destroying(serverA, old)

	if fs.instances[serverA] != current {
		t.Fatal("newer instance was removed")
	}
	if len(repo.statuses) != 0 {
		t.Fatalf("status was overwritten: %v", repo.statuses)
	}
	select {
	case <-old.stopped:
	default:
		t.Fatal("old instance not marked stopped")
	}

	fs.destroying(serverA, current)
	if fs.IsServerRunning(serverA) {
		t.Fatal("current instance not removed")
	}
	if len(repo.statuses) != 1 || repo.statuses[0] != serverdomain.ServerStatusStopped {
		t.Fatalf("got statuses %v, want [stopped]", repo.statuses)
	}
}

func TestTerminateCancelsStartingInstance(t *testing.T) {
	fs := newTestService(&fakeServerRepo{})
	id := serverA
	inst := &instance{stopped: make(chan struct{})}
	fs.instances[id] = inst

	done := make(chan error, 1)
	go func() { done <- fs.TerminateFrpc(&id) }()

	// Stand in for LaunchFrpc: once it sees the stop request it gives up and closes stopped.
	waitFor(t, func() bool {
		fs.mu.Lock()
		defer fs.mu.Unlock()
		return inst.stopRequested
	})
	close(inst.stopped)

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("TerminateFrpc = %v, want nil", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("TerminateFrpc did not return after the launch gave up")
	}
}
