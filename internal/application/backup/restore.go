package backup

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/hook"
)

var ErrBusy = errors.New("another backup or restore is in progress")

// RestoreJob is also a narrowly scoped capability: its unpredictable ID permits
// reading only this operation's status after the restored DB invalidates login.
// Never put the ID in URLs or logs. Only the latest job is retained, for 24 hours.
type RestoreJob struct {
	ID        string    `json:"id"`
	State     string    `json:"state"`
	Error     string    `json:"error,omitempty"`
	StartedAt time.Time `json:"startedAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type restoreContextKey struct{}

type restoringApp struct {
	core.App
	beforeRestart   func() error
	restartReturned func() error
}

func (a *restoringApp) Restart() error {
	// PocketBase invokes this only AFTER replacing the data directory. Marking
	// an OnTerminate hook or observing /health cannot prove the data was replaced.
	if err := a.beforeRestart(); err != nil {
		return err // PocketBase reverts the data directory on restart failure.
	}
	err := a.App.Restart()
	// A returned restart is not an exec, even if another hook returned nil.
	// Reset before PB rolls data back so a crash during rollback fails closed.
	if statusErr := a.restartReturned(); statusErr != nil {
		return statusErr
	}
	return err
}

// RegisterHooks serializes native/scheduled and Podux backup operations. The
// restore wrapper records the exact data-replaced -> exec boundary, not merely
// an unrelated process restart. The journal lives in local backups, which PB
// excludes from both backup creation and restore (including when S3 is enabled).
func (s *Service) RegisterHooks() {
	s.hooksOnce.Do(func() {
		s.app.OnBackupCreate().Bind(&hook.Handler[*core.BackupEvent]{
			Id: "podux_backup_operation", Priority: -1000,
			Func: func(e *core.BackupEvent) error {
				s.mu.Lock()
				active := s.active
				s.mu.Unlock()
				if active || !s.operation.TryLock() {
					return ErrBusy
				}
				defer s.operation.Unlock()
				return e.Next()
			},
		})
		s.app.OnBackupRestore().Bind(&hook.Handler[*core.BackupEvent]{
			Id: "podux_restore_operation", Priority: -1000,
			Func: func(e *core.BackupEvent) error {
				if !s.operation.TryLock() {
					return ErrBusy
				}
				defer s.operation.Unlock()
				id, _ := e.Context.Value(restoreContextKey{}).(string)
				if id == "" {
					return e.Next()
				}
				original := e.App
				e.App = &restoringApp{App: original, beforeRestart: func() error {
					return s.transition(id, "restarting", "")
				}, restartReturned: func() error {
					return s.transition(id, "failed", "restart_unconfirmed")
				}}
				defer func() { e.App = original }()
				return e.Next()
			},
		})
	})
}

// RecoverRestore is called once on serving a successfully bootstrapped process.
// Queued/running operations interrupted before replacement are NEVER successful.
func (s *Service) RecoverRestore() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active {
		return ErrBusy
	}
	job, err := s.readJob()
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	switch job.State {
	case "restarting":
		job.State, job.Error = "succeeded", ""
	case "queued", "running":
		job.State, job.Error = "failed", "restore_interrupted"
	default:
		return nil
	}
	job.UpdatedAt = time.Now().UTC()
	return s.writeJob(job)
}

// StartRestore persists acceptance before launching a single background job.
// The short delay lets the response flush; it is NOT used to infer completion.
func (s *Service) StartRestore(name string) (*RestoreJob, error) {
	if !validName(name) {
		return nil, ErrInvalidName
	}
	s.RegisterHooks()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ctx.Err() != nil {
		return nil, s.ctx.Err()
	}
	if s.active || s.app.Store().Has(core.StoreKeyActiveBackup) {
		return nil, ErrBusy
	}
	if !s.Exists(name) {
		return nil, ErrNotFound
	}
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	job := &RestoreJob{ID: hex.EncodeToString(token[:]), State: "queued", StartedAt: now, UpdatedAt: now}
	if err := s.writeJob(job); err != nil {
		return nil, err
	}
	s.active = true
	s.work.Add(1)
	go s.runRestore(job.ID, name)
	return job, nil
}

func (s *Service) runRestore(id, name string) {
	defer s.work.Done()
	defer func() { s.mu.Lock(); s.active = false; s.mu.Unlock() }()
	timer := time.NewTimer(s.restoreDelay)
	defer timer.Stop()
	select {
	case <-s.ctx.Done():
		_ = s.transition(id, "failed", "restore_interrupted")
		return
	case <-timer.C:
	}
	if err := s.transition(id, "running", ""); err != nil {
		s.app.Logger().Error("Cannot persist restore status", "error", err)
		return
	}
	ctx, cancel := context.WithTimeout(context.WithValue(s.ctx, restoreContextKey{}, id), 30*time.Minute)
	defer cancel()
	err := s.Restore(ctx, name)
	// A real successful exec never returns. A hook short-circuit, or a restart
	// suppressed by another hook, must not be mistaken for confirmed success.
	code := "restart_unconfirmed"
	if err != nil {
		code = "restore_failed"
	}
	if ctx.Err() != nil {
		code = "restore_interrupted"
	}
	if err := s.transition(id, "failed", code); err != nil {
		s.app.Logger().Error("Cannot persist failed restore status", "error", err)
	}
	// Do not expose filesystem/S3 errors (which may contain credentials) to the
	// capability endpoint or log raw provider errors.
	s.app.Logger().Error("Backup restore did not complete", "reason", code)
}

// Stop cancels queued/context-aware work and waits on normal shutdown. PB's
// synchronous local extraction may finish before observing cancellation. Do not
// call this from restore's own restart hook: it would wait on the same goroutine.
func (s *Service) Stop() {
	s.mu.Lock()
	s.cancel()
	s.mu.Unlock()
	s.work.Wait()
}

func (s *Service) RestoreStatus(id string) (*RestoreJob, error) {
	if len(id) != 64 {
		return nil, ErrNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	job, err := s.readJob()
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if subtle.ConstantTimeCompare([]byte(id), []byte(job.ID)) != 1 || time.Since(job.UpdatedAt) > 24*time.Hour {
		return nil, ErrNotFound
	}
	return job, nil
}

func (s *Service) transition(id, state, code string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, err := s.readJob()
	if err != nil {
		return err
	}
	if job.ID != id {
		return ErrNotFound
	}
	job.State, job.Error, job.UpdatedAt = state, code, time.Now().UTC()
	return s.writeJob(job)
}

func (s *Service) journalPath() string {
	return filepath.Join(s.app.DataDir(), core.LocalBackupsDirName, ".podux-restore.json")
}

func (s *Service) readJob() (*RestoreJob, error) {
	data, err := os.ReadFile(s.journalPath())
	if err != nil {
		return nil, err
	}
	var job RestoreJob
	if err := json.Unmarshal(data, &job); err != nil {
		return nil, fmt.Errorf("invalid restore journal: %w", err)
	}
	return &job, nil
}

func (s *Service) writeJob(job *RestoreJob) error {
	path := s.journalPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(job)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".restore-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if _, err := f.Write(data); err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(f.Name(), path); err != nil {
		return err
	}
	// Flush the rename as well; an unconfirmed journal fails closed on restart.
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
