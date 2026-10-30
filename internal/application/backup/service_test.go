package backup

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"podux/internal/testutil"
)

func TestBackupLifecycle(t *testing.T) {
	app := testutil.NewApp(t)
	s := NewService(app)

	name, err := s.Create(context.Background(), "0.2.5")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(name, "podux_0-2-5_") || !strings.HasSuffix(name, ".zip") {
		t.Errorf("backup name = %q", name)
	}

	list, err := s.List()
	if err != nil || len(list) != 1 || list[0].Name != name || list[0].Size == 0 || list[0].Auto {
		t.Fatalf("list = %+v, %v", list, err)
	}

	r, size, err := s.Open(name)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(r)
	r.Close()
	if int64(len(data)) != size || !bytes.HasPrefix(data, []byte("PK")) {
		t.Errorf("download: %d bytes (size %d), zip header %q", len(data), size, data[:2])
	}

	// Upload it back under another name, as if restoring on a new machine.
	fh := multipartFile(t, "copy.zip", data)
	if got, err := s.Upload(fh); err != nil || got != "copy.zip" {
		t.Fatalf("upload: %q %v", got, err)
	}
	if _, err := s.Upload(fh); !errors.Is(err, ErrExists) {
		t.Errorf("second upload: %v, want ErrExists", err)
	}
	// (multipart already strips directories from file names)
	if _, err := s.Upload(multipartFile(t, "backup.tar.gz", data)); !errors.Is(err, ErrInvalidName) {
		t.Errorf("non-zip name: %v, want ErrInvalidName", err)
	}

	if err := s.Delete(name); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(name); !errors.Is(err, ErrNotFound) {
		t.Errorf("delete twice: %v", err)
	}
	if _, _, err := s.Open("../data.db"); !errors.Is(err, ErrInvalidName) {
		t.Errorf("open outside the backups dir: %v", err)
	}
}

func TestSchedule(t *testing.T) {
	app := testutil.NewApp(t)
	s := NewService(app)

	if err := s.SetSchedule(Schedule{Cron: "0 3 * * *", Keep: 0}); err != nil {
		t.Fatal(err)
	}
	if got := s.GetSchedule(); got.Cron != "0 3 * * *" || got.Keep != 1 {
		t.Errorf("schedule = %+v, want daily at 3 keeping at least 1", got)
	}
	if err := s.SetSchedule(Schedule{Cron: "every day"}); err == nil {
		t.Error("invalid cron accepted")
	}
	if err := s.SetSchedule(Schedule{}); err != nil || s.GetSchedule().Cron != "" {
		t.Errorf("turning the schedule off: %v", err)
	}
}

func multipartFile(t *testing.T, name string, content []byte) *multipart.FileHeader {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, _ := w.CreateFormFile("file", name)
	part.Write(content)
	w.Close()
	req := httptest.NewRequest("POST", "/", &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	if err := req.ParseMultipartForm(1 << 20); err != nil {
		t.Fatal(err)
	}
	return req.MultipartForm.File["file"][0]
}
