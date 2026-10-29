package frpc

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/fatedier/frp/pkg/util/log"
	"github.com/fatedier/frp/pkg/util/xlog"
	golog "github.com/fatedier/golib/log"
)

// frp writes every client's output through one package-level logger, so all
// servers share a single log file. Each server's frp context carries a
// "[podux:<id>]" prefix that StreamLog uses to pick out that server's lines.
const serverLogPrefixName = "podux"

func sharedLogPath() string {
	return filepath.Join("pb_data", "frpc", "frpc.log")
}

func serverLogTag(serverID string) string {
	return "[" + serverLogPrefixName + ":" + serverID + "] "
}

// newServerLogger returns the frp xlog that tags every line with the server id.
func newServerLogger(serverID string) *xlog.Logger {
	return xlog.New().AddPrefix(xlog.LogPrefix{
		Name:     serverLogPrefixName,
		Value:    serverLogPrefixName + ":" + serverID,
		Priority: 1,
	})
}

// sharedLogger initializes the frp global logger once and only ever lowers its
// level, so the most verbose level requested by a running server is captured.
type sharedLogger struct {
	mu          sync.Mutex
	initialized bool
	level       golog.Level
}

func (l *sharedLogger) ensure(levelStr string, maxDays int) {
	level := parseLevel(levelStr)

	l.mu.Lock()
	defer l.mu.Unlock()

	if !l.initialized {
		path := sharedLogPath()
		_ = os.MkdirAll(filepath.Dir(path), 0755)
		log.InitLogger(path, level.String(), maxDays, true)
		l.initialized = true
		l.level = level
		return
	}
	if level < l.level {
		log.Logger = log.Logger.WithOptions(golog.WithLevel(level))
		l.level = level
	}
}

func parseLevel(s string) golog.Level {
	level, err := golog.ParseLevel(s)
	if err != nil {
		return golog.InfoLevel
	}
	return level
}

var levelTags = map[string]golog.Level{
	"[T]": golog.TraceLevel,
	"[D]": golog.DebugLevel,
	"[I]": golog.InfoLevel,
	"[W]": golog.WarnLevel,
	"[E]": golog.ErrorLevel,
}

// lineFilter selects one server's lines at or above its configured level and
// strips the server tag from them.
type lineFilter struct {
	tag      string
	minLevel golog.Level
}

func newLineFilter(serverID, levelStr string) lineFilter {
	return lineFilter{tag: serverLogTag(serverID), minLevel: parseLevel(levelStr)}
}

func (f lineFilter) apply(line string) (string, bool) {
	idx := strings.Index(line, f.tag)
	if idx < 0 {
		return "", false
	}
	// Lines look like "2006-01-02 15:04:05.000 [I] [caller] [podux:id] msg".
	if fields := strings.SplitN(line, " ", 4); len(fields) >= 3 {
		if level, ok := levelTags[fields[2]]; ok && level < f.minLevel {
			return "", false
		}
	}
	return line[:idx] + line[idx+len(f.tag):], true
}

// tailMatching returns up to n of the last lines in file accepted by match,
// reading backwards at most maxBytes.
func tailMatching(file *os.File, n int, maxBytes int64, match func(string) (string, bool)) []string {
	fi, err := file.Stat()
	if err != nil || fi.Size() == 0 {
		return nil
	}

	const chunkSize = 64 * 1024
	end := fi.Size()
	pos := end
	var buf []byte
	var out []string

	for pos > 0 && end-pos < maxBytes && len(out) < n {
		size := int64(chunkSize)
		if size > pos {
			size = pos
		}
		pos -= size
		chunk := make([]byte, size)
		if _, err := file.ReadAt(chunk, pos); err != nil && err != io.EOF {
			break
		}
		buf = append(chunk, buf...)

		// Everything after the first newline is made of complete lines (unless
		// we've reached the start of the file).
		cut := 0
		if pos > 0 {
			i := bytes.IndexByte(buf, '\n')
			if i < 0 {
				continue
			}
			cut = i + 1
		}
		lines := strings.Split(strings.TrimRight(string(buf[cut:]), "\n"), "\n")
		var matched []string
		for _, line := range lines {
			if s, ok := match(line); ok {
				matched = append(matched, s)
			}
		}
		out = append(matched, out...)
		buf = buf[:cut]
	}

	if len(out) > n {
		out = out[len(out)-n:]
	}
	return out
}

// lineReader yields complete lines appended to a file, keeping any trailing
// partial line until its newline arrives.
type lineReader struct {
	partial []byte
}

func (r *lineReader) feed(data []byte) []string {
	r.partial = append(r.partial, data...)
	last := bytes.LastIndexByte(r.partial, '\n')
	if last < 0 {
		return nil
	}
	complete := string(r.partial[:last])
	r.partial = append([]byte(nil), r.partial[last+1:]...)
	return strings.Split(complete, "\n")
}

func (r *lineReader) reset() {
	r.partial = nil
}
