package frpc

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fatedier/frp/pkg/util/log"
	"github.com/fatedier/frp/pkg/util/xlog"
	golog "github.com/fatedier/golib/log"
)

// frp writes every client's output through one package-level logger, so all
// servers share a single log file. Each server's frp context carries a
// "[podux:<id>]" prefix that StreamLog uses to pick out that server's lines.
const serverLogPrefixName = "podux"

func sharedLogPath(dataDir string) string {
	return filepath.Join(dataDir, "frpc", "frpc.log")
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
// threshold, so the most verbose level requested by a running server is captured.
// log.Logger is a plain package variable that running clients read on every line, so
// it is assigned only once, before any frpc runs; later level changes go through an
// atomic threshold in the output filter instead of swapping the logger.
type sharedLogger struct {
	mu          sync.Mutex
	initialized bool
	threshold   atomic.Int32 // golog.Level
}

func (l *sharedLogger) ensure(path, levelStr string, maxDays int) {
	level := parseLevel(levelStr)

	l.mu.Lock()
	defer l.mu.Unlock()

	if !l.initialized {
		_ = os.MkdirAll(filepath.Dir(path), 0755)
		writer := golog.NewRotateFileWriter(golog.RotateFileConfig{
			FileName: path,
			Mode:     golog.RotateFileModeDaily,
			MaxDays:  maxDays,
		})
		writer.Init()
		l.threshold.Store(int32(level))
		log.Logger = log.Logger.WithOptions(
			golog.WithOutput(&levelFilter{out: writer, threshold: &l.threshold}),
			golog.WithLevel(golog.TraceLevel),
		)
		l.initialized = true
		return
	}
	if int32(level) < l.threshold.Load() {
		l.threshold.Store(int32(level))
	}
}

// levelFilter drops log lines below the shared threshold before they reach the file.
type levelFilter struct {
	out       io.Writer
	threshold *atomic.Int32
}

func (f *levelFilter) Write(p []byte) (int, error) {
	return f.out.Write(p)
}

// WriteLog implements golib's log.Writer, which the logger prefers over Write.
func (f *levelFilter) WriteLog(p []byte, level golog.Level, _ time.Time) (int, error) {
	if int32(level) < f.threshold.Load() {
		return len(p), nil
	}
	return f.out.Write(p)
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

// AllServers is the server ID that selects the whole frpc log, including lines
// that belong to no server.
const AllServers = "all"

// lineFilter selects one server's lines at or above its configured level and
// strips the server tag from them. With names set (the AllServers view) it keeps
// every line and replaces server tags with "[<server name>] ".
type lineFilter struct {
	tag      string
	minLevel golog.Level
	names    map[string]string
}

func newLineFilter(serverID, levelStr string) lineFilter {
	return lineFilter{tag: serverLogTag(serverID), minLevel: parseLevel(levelStr)}
}

// newAllFilter keeps every line, naming servers by their display names.
func newAllFilter(names map[string]string) lineFilter {
	return lineFilter{minLevel: golog.TraceLevel, names: names}
}

func (f lineFilter) apply(line string) (string, bool) {
	if f.names != nil {
		start := strings.Index(line, "["+serverLogPrefixName+":")
		if start < 0 {
			return line, true
		}
		end := strings.Index(line[start:], "] ")
		if end < 0 {
			return line, true
		}
		id := line[start+len(serverLogPrefixName)+2 : start+end]
		name := f.names[id]
		if name == "" {
			name = id
		}
		return line[:start] + "[" + name + "] " + line[start+end+2:], true
	}
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
