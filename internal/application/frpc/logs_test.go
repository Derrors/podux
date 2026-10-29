package frpc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	serverA = "aaaaaaaaaaaaaaa"
	serverB = "bbbbbbbbbbbbbbb"
)

func logLine(level, serverID, msg string) string {
	return fmt.Sprintf("2026-10-29 10:00:00.000 %s [client/service.go:1] [podux:%s] %s", level, serverID, msg)
}

func TestLineFilter(t *testing.T) {
	f := newLineFilter(serverA, "info")

	got, ok := f.apply(logLine("[I]", serverA, "login to server success"))
	if !ok {
		t.Fatal("expected own info line to match")
	}
	if strings.Contains(got, "podux:") || !strings.HasSuffix(got, "login to server success") {
		t.Fatalf("server tag not stripped: %q", got)
	}
	if _, ok := f.apply(logLine("[I]", serverB, "other server")); ok {
		t.Fatal("other server's line must not match")
	}
	if _, ok := f.apply(logLine("[D]", serverA, "debug noise")); ok {
		t.Fatal("debug line must be filtered at info level")
	}
	if _, ok := f.apply("2026-10-29 10:00:00.000 [I] [client/service.go:1] untagged"); ok {
		t.Fatal("untagged line must not match")
	}
	if _, ok := newLineFilter(serverA, "trace").apply(logLine("[D]", serverA, "debug")); !ok {
		t.Fatal("debug line must match at trace level")
	}
}

func TestTailMatchingSkipsOtherServers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "frpc.log")
	var b strings.Builder
	for i := 0; i < 5000; i++ {
		id := serverB
		if i%100 == 0 {
			id = serverA
		}
		b.WriteString(logLine("[I]", id, fmt.Sprintf("line %d", i)) + "\n")
	}
	if err := os.WriteFile(path, []byte(b.String()), 0644); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	got := tailMatching(file, 10, 1<<30, newLineFilter(serverA, "info").apply)
	if len(got) != 10 {
		t.Fatalf("got %d lines, want 10", len(got))
	}
	// Server A wrote lines 0, 100, ..., 4900; the last ten are 4000..4900 in order.
	for i, line := range got {
		want := fmt.Sprintf("line %d", 4000+i*100)
		if !strings.HasSuffix(line, want) {
			t.Fatalf("line %d = %q, want suffix %q", i, line, want)
		}
	}

	if got := tailMatching(file, 10, 1024, newLineFilter(serverA, "info").apply); len(got) >= 10 {
		t.Fatalf("maxBytes not respected: got %d lines", len(got))
	}
}

func TestLineReaderKeepsPartialLines(t *testing.T) {
	var r lineReader
	if got := r.feed([]byte("first line\nsecond ha")); len(got) != 1 || got[0] != "first line" {
		t.Fatalf("got %q", got)
	}
	if got := r.feed([]byte("lf\nthird")); len(got) != 1 || got[0] != "second half" {
		t.Fatalf("got %q", got)
	}
	r.reset()
	if got := r.feed([]byte("fresh\n")); len(got) != 1 || got[0] != "fresh" {
		t.Fatalf("got %q after reset", got)
	}
}
