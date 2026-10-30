package httphandler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"podux/internal/application/backup"
	"podux/pkg/buildinfo"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// maxBackupUpload caps uploaded backup zips (PocketBase's default body limit is 32MB).
const maxBackupUpload = 2 << 30

type BackupHandler struct {
	app     core.App
	service *backup.Service
}

func NewBackupHandler(app core.App, service *backup.Service) *BackupHandler {
	return &BackupHandler{app: app, service: service}
}

func backupError(e *core.RequestEvent, err error) error {
	switch {
	case errors.Is(err, backup.ErrInvalidName), errors.Is(err, backup.ErrExists):
		return e.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, backup.ErrNotFound):
		return e.JSON(http.StatusNotFound, map[string]string{"error": err.Error()})
	default:
		return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}

func (h *BackupHandler) RegisterHandlers(e *core.ServeEvent) {
	e.Router.GET("/api/system/backups", requireAuth(func(e *core.RequestEvent) error {
		list, err := h.service.List()
		if err != nil {
			return backupError(e, err)
		}
		return e.JSON(http.StatusOK, map[string]any{"backups": list, "schedule": h.service.GetSchedule()})
	}))

	e.Router.POST("/api/system/backups", requireAuth(func(e *core.RequestEvent) error {
		name, err := h.service.Create(e.Request.Context(), buildinfo.AppVersion)
		if err != nil {
			return backupError(e, err)
		}
		return e.JSON(http.StatusOK, map[string]string{"name": name})
	}))

	e.Router.PUT("/api/system/backups/schedule", requireAuth(func(e *core.RequestEvent) error {
		var sc backup.Schedule
		if err := e.BindBody(&sc); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		}
		if err := h.service.SetSchedule(sc); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, h.service.GetSchedule())
	}))

	e.Router.POST("/api/system/backups/upload", requireAuth(func(e *core.RequestEvent) error {
		_, fh, err := e.Request.FormFile("file")
		if err != nil {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "missing backup file"})
		}
		name, err := h.service.Upload(fh)
		if err != nil {
			return backupError(e, err)
		}
		return e.JSON(http.StatusOK, map[string]string{"name": name})
	})).Bind(apis.BodyLimit(maxBackupUpload))

	e.Router.GET("/api/system/backups/{name}", requireAuth(func(e *core.RequestEvent) error {
		name := e.Request.PathValue("name")
		r, size, err := h.service.Open(name)
		if err != nil {
			return backupError(e, err)
		}
		defer r.Close()
		e.Response.Header().Set("Content-Type", "application/zip")
		e.Response.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
		e.Response.Header().Set("Content-Length", strconv.FormatInt(size, 10))
		e.Response.WriteHeader(http.StatusOK)
		_, err = io.Copy(e.Response, r)
		return err
	}))

	e.Router.DELETE("/api/system/backups/{name}", requireAuth(func(e *core.RequestEvent) error {
		if err := h.service.Delete(e.Request.PathValue("name")); err != nil {
			return backupError(e, err)
		}
		return e.NoContent(http.StatusNoContent)
	}))

	// Restore answers first, then replaces the data and restarts Podux in the background.
	e.Router.POST("/api/system/backups/{name}/restore", requireAuth(func(e *core.RequestEvent) error {
		name := e.Request.PathValue("name")
		if !h.service.Exists(name) {
			return backupError(e, backup.ErrNotFound)
		}
		go func() {
			time.Sleep(500 * time.Millisecond) // let the response reach the client
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
			defer cancel()
			if err := h.service.Restore(ctx, name); err != nil {
				h.app.Logger().Error("Failed to restore backup", "name", name, "error", err)
			}
		}()
		return e.JSON(http.StatusAccepted, map[string]string{"message": "restoring; Podux restarts when done"})
	}))
}
