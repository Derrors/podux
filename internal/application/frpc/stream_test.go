package frpc

import (
	"context"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"podux/internal/testutil"
)

// syncRecorder lets the test read the response while StreamLog is still writing.
type syncRecorder struct {
	*httptest.ResponseRecorder
	mu sync.Mutex
}

func (r *syncRecorder) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.ResponseRecorder.Write(p)
}

func (r *syncRecorder) body() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.Body.String()
}

func TestStreamLogMissingFile(t *testing.T) {
	fs := NewService(testutil.NewApp(t), &fakeServerRepo{}, fakeProxyRepo{}, nil)
	rec := httptest.NewRecorder()

	err := fs.StreamLog(serverA, context.Background(), rec, rec)
	if !errors.Is(err, ErrLogNotFound) {
		t.Fatalf("err = %v, want ErrLogNotFound", err)
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("wrote %q before failing", rec.Body.String())
	}
}

func TestStreamLogReplayThenLive(t *testing.T) {
	app := testutil.NewApp(t)
	path := sharedLogPath(app.DataDir())
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	history := logLine("[I]", serverA, "old line") + "\n" + logLine("[I]", serverB, "other server") + "\n"
	if err := os.WriteFile(path, []byte(history), 0644); err != nil {
		t.Fatal(err)
	}

	fs := NewService(app, &fakeServerRepo{}, fakeProxyRepo{}, nil)
	out := &syncRecorder{ResponseRecorder: httptest.NewRecorder()}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- fs.StreamLog(serverA, ctx, out, out)
	}()

	waitFor(t, func() bool { return strings.Contains(out.body(), replayEndFrame) })

	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		t.Fatal(err)
	}
	// A line written in two parts must arrive once, complete.
	f.WriteString(logLine("[I]", serverA, "new li"))
	f.Sync()
	time.Sleep(600 * time.Millisecond)
	f.WriteString("ne\n")
	f.Close()

	waitFor(t, func() bool { return strings.Contains(out.body(), "new line") })
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("StreamLog returned %v", err)
	}

	body := out.body()
	replay, live, _ := strings.Cut(body, replayEndFrame)
	if !strings.Contains(replay, "old line") || strings.Contains(body, "other server") {
		t.Fatalf("replay = %q", replay)
	}
	if strings.Count(live, "data: ") != 1 || !strings.Contains(live, "] new line\n\n") {
		t.Fatalf("live part = %q, want exactly one complete line", live)
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(20 * time.Millisecond)
	}
}
