package notify

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestDispatchIsBoundedAndStopCancels(t *testing.T) {
	var active, peak atomic.Int32
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		n := active.Add(1)
		defer active.Add(-1)
		for old := peak.Load(); n > old && !peak.CompareAndSwap(old, n); old = peak.Load() {
		}
		entered <- struct{}{}
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer func() { close(release); server.Close() }()
	s, _, _ := newTestService(t, "en", func(settings *Settings) {
		settings.Webhook.Enabled = true
		settings.Webhook.URL = server.URL
	})
	t.Cleanup(s.Stop)
	for range 100 {
		s.dispatch(Message{Event: EventTest})
	}
	for range 2 {
		select {
		case <-entered:
		case <-time.After(3 * time.Second):
			t.Fatal("workers did not start")
		}
	}
	s.queueMu.Lock()
	if len(s.queue) > 256 || cap(s.queue) != 256 {
		t.Fatal("unbounded queue")
	}
	s.queueMu.Unlock()
	s.Stop()
	if peak.Load() != 2 {
		t.Fatalf("concurrency = %d, want 2", peak.Load())
	}
	s.dispatch(Message{Event: EventTest}) // shutdown cannot restart workers
}
