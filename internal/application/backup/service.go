// Package backup lists, creates, restores and schedules backups of the data directory.
// It wraps PocketBase's backups (zip files in <data>/backups), whose own API is
// superuser-only, for Podux's signed-in users.
package backup

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"regexp"
	"sort"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/cron"
)

// autoPrefix is how PocketBase names the backups made by its cron schedule.
const autoPrefix = "@auto_pb_backup_"

// nameRegex accepts Podux, PocketBase and scheduled ("@auto_pb_backup_...") backup names.
var nameRegex = regexp.MustCompile(`^@?[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.zip$`)

var (
	ErrInvalidName = errors.New("invalid backup name")
	ErrNotFound    = errors.New("backup not found")
	ErrExists      = errors.New("a backup with this name already exists")
)

// Info describes one backup file.
type Info struct {
	Name     string    `json:"name"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
	// Auto is true for backups made by the schedule (pruned to Schedule.Keep).
	Auto bool `json:"auto"`
}

// Schedule is PocketBase's automatic backup setting. An empty Cron turns it off.
type Schedule struct {
	Cron string `json:"cron"`
	Keep int    `json:"keep"`
}

type Service struct {
	app core.App
}

func NewService(app core.App) *Service {
	return &Service{app: app}
}

func validName(name string) bool {
	return nameRegex.MatchString(name) && !strings.Contains(name, "..")
}

// List returns the backups, newest first.
func (s *Service) List() ([]Info, error) {
	fsys, err := s.app.NewBackupsFilesystem()
	if err != nil {
		return nil, err
	}
	defer fsys.Close()

	objects, err := fsys.List("")
	if err != nil {
		return nil, err
	}
	out := make([]Info, 0, len(objects))
	for _, o := range objects {
		if !validName(o.Key) {
			continue
		}
		out = append(out, Info{Name: o.Key, Size: o.Size, Modified: o.ModTime, Auto: strings.HasPrefix(o.Key, autoPrefix)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Modified.After(out[j].Modified) })
	return out, nil
}

// Create backs up the data directory now and returns the new backup's name.
func (s *Service) Create(ctx context.Context, version string) (string, error) {
	name := fmt.Sprintf("podux_%s_%s.zip", strings.ReplaceAll(version, ".", "-"), time.Now().UTC().Format("20060102_150405"))
	if err := s.app.CreateBackup(ctx, name); err != nil {
		return "", err
	}
	return name, nil
}

// Open returns a reader for downloading a backup and its size.
func (s *Service) Open(name string) (io.ReadCloser, int64, error) {
	if !validName(name) {
		return nil, 0, ErrInvalidName
	}
	fsys, err := s.app.NewBackupsFilesystem()
	if err != nil {
		return nil, 0, err
	}
	if ok, _ := fsys.Exists(name); !ok {
		fsys.Close()
		return nil, 0, ErrNotFound
	}
	r, err := fsys.GetReader(name)
	if err != nil {
		fsys.Close()
		return nil, 0, err
	}
	return &closeBoth{ReadCloser: r, closeFS: fsys.Close}, r.Size(), nil
}

type closeBoth struct {
	io.ReadCloser
	closeFS func() error
}

func (c *closeBoth) Close() error {
	err := c.ReadCloser.Close()
	_ = c.closeFS()
	return err
}

// Delete removes a backup.
func (s *Service) Delete(name string) error {
	if !validName(name) {
		return ErrInvalidName
	}
	fsys, err := s.app.NewBackupsFilesystem()
	if err != nil {
		return err
	}
	defer fsys.Close()
	if ok, _ := fsys.Exists(name); !ok {
		return ErrNotFound
	}
	return fsys.Delete(name)
}

// Upload stores an uploaded backup zip under its own file name.
func (s *Service) Upload(fh *multipart.FileHeader) (string, error) {
	name := fh.Filename
	if !validName(name) {
		return "", ErrInvalidName
	}
	fsys, err := s.app.NewBackupsFilesystem()
	if err != nil {
		return "", err
	}
	defer fsys.Close()
	if ok, _ := fsys.Exists(name); ok {
		return "", ErrExists
	}
	return name, fsys.UploadMultipart(fh, name)
}

// Restore replaces the data directory with a backup. PocketBase stops frpc (via
// the terminate hooks) and restarts the process when it succeeds, so callers
// should answer the request before calling it.
func (s *Service) Restore(ctx context.Context, name string) error {
	if !validName(name) {
		return ErrInvalidName
	}
	return s.app.RestoreBackup(ctx, name)
}

// Exists reports whether a backup exists, so a restore can be validated up front.
func (s *Service) Exists(name string) bool {
	if !validName(name) {
		return false
	}
	fsys, err := s.app.NewBackupsFilesystem()
	if err != nil {
		return false
	}
	defer fsys.Close()
	ok, _ := fsys.Exists(name)
	return ok
}

// GetSchedule returns the automatic backup schedule.
func (s *Service) GetSchedule() Schedule {
	b := s.app.Settings().Backups
	return Schedule{Cron: b.Cron, Keep: b.CronMaxKeep}
}

// SetSchedule saves the automatic backup schedule; PocketBase reloads its cron job.
func (s *Service) SetSchedule(sc Schedule) error {
	sc.Cron = strings.TrimSpace(sc.Cron)
	if sc.Cron != "" {
		if _, err := cron.NewSchedule(sc.Cron); err != nil {
			return fmt.Errorf("invalid cron expression: %w", err)
		}
		if sc.Keep < 1 {
			sc.Keep = 1
		}
	}
	settings := s.app.Settings()
	settings.Backups.Cron = sc.Cron
	settings.Backups.CronMaxKeep = sc.Keep
	return s.app.Save(settings)
}
