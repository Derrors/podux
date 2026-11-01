package backup

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"podux/internal/testutil"
)

func TestRestoreFailureIsQueryableAndExclusive(t *testing.T) {
	app := testutil.NewApp(t)
	s := NewService(app)
	t.Cleanup(s.Stop)
	s.restoreDelay = time.Millisecond
	name, err := s.Create(context.Background(), "test")
	if err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	app.OnBackupRestore().BindFunc(func(e *core.BackupEvent) error {
		close(entered)
		<-release
		return errors.New("synthetic restore failure")
	})
	job, err := s.StartRestore(name)
	if err != nil {
		t.Fatal(err)
	}
	if len(job.ID) != 64 || job.State != "queued" {
		t.Fatalf("invalid job: %#v", job)
	}
	<-entered
	if _, err := s.StartRestore(name); !errors.Is(err, ErrBusy) {
		t.Fatalf("second restore: %v", err)
	}
	if err := s.Delete(name); !errors.Is(err, ErrBusy) {
		t.Fatalf("delete during restore: %v", err)
	}
	if _, err := s.Create(context.Background(), "second"); err == nil {
		t.Fatal("backup during restore accepted")
	}
	close(release)
	s.work.Wait()
	got, err := s.RestoreStatus(job.ID)
	if err != nil || got.State != "failed" || got.Error != "restore_failed" {
		t.Fatalf("result: %#v, %v", got, err)
	}
	if _, err := s.RestoreStatus(strings.Repeat("0", 64)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("wrong capability: %v", err)
	}
	info, err := os.Stat(s.journalPath())
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("journal permissions: %v %v", info, err)
	}
}

func TestRestoreRecoveryRequiresReplacementCheckpoint(t *testing.T) {
	for _, state := range []string{"queued", "running", "restarting", "failed"} {
		t.Run(state, func(t *testing.T) {
			s := NewService(testutil.NewApp(t))
			t.Cleanup(s.Stop)
			now := time.Now().UTC()
			job := &RestoreJob{ID: strings.Repeat("1", 64), State: state, StartedAt: now, UpdatedAt: now}
			if err := s.writeJob(job); err != nil {
				t.Fatal(err)
			}
			if err := s.RecoverRestore(); err != nil {
				t.Fatal(err)
			}
			got, err := s.RestoreStatus(job.ID)
			if err != nil {
				t.Fatal(err)
			}
			want := "failed"
			if state == "restarting" {
				want = "succeeded"
			}
			if got.State != want {
				t.Fatalf("%s -> %s, want %s", state, got.State, want)
			}
		})
	}
}

func TestRestoreShortCircuitCannotReportSuccess(t *testing.T) {
	app := testutil.NewApp(t)
	s := NewService(app)
	t.Cleanup(s.Stop)
	s.restoreDelay = 0
	name, err := s.Create(context.Background(), "test")
	if err != nil {
		t.Fatal(err)
	}
	app.OnBackupRestore().BindFunc(func(e *core.BackupEvent) error { return nil })
	job, err := s.StartRestore(name)
	if err != nil {
		t.Fatal(err)
	}
	s.work.Wait()
	got, err := s.RestoreStatus(job.ID)
	if err != nil || got.State != "failed" {
		t.Fatalf("result: %#v %v", got, err)
	}
}

func TestStopCancelsQueuedRestore(t *testing.T) {
	s := NewService(testutil.NewApp(t))
	s.restoreDelay = time.Hour
	name, err := s.Create(context.Background(), "test")
	if err != nil {
		t.Fatal(err)
	}
	job, err := s.StartRestore(name)
	if err != nil {
		t.Fatal(err)
	}
	s.Stop()
	got, err := s.RestoreStatus(job.ID)
	if err != nil || got.State != "failed" {
		t.Fatalf("result: %#v %v", got, err)
	}
	if _, err := s.StartRestore(name); !errors.Is(err, context.Canceled) {
		t.Fatalf("start after stop: %v", err)
	}
}

func TestUploadRejectsInvalidArchive(t *testing.T) {
	s := NewService(testutil.NewApp(t))
	t.Cleanup(s.Stop)
	if _, err := s.Upload(multipartFile(t, "bad.zip", []byte("not a zip"))); !errors.Is(err, ErrInvalidArchive) {
		t.Fatal(err)
	}
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	f, _ := z.Create("../data.db")
	_, _ = f.Write([]byte("SQLite format 3\x00"))
	_ = z.Close()
	if _, err := s.Upload(multipartFile(t, "traversal.zip", b.Bytes())); !errors.Is(err, ErrInvalidArchive) {
		t.Fatal(err)
	}
}
