package httphandler

import (
	"errors"
	"net/http"
	"time"

	"podux/internal/application/apikey"
	"podux/internal/application/frpc"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

type FrpcHandler struct {
	app     core.App
	service *frpc.Service
}

func NewFrpcHandler(app core.App, service *frpc.Service) *FrpcHandler {
	return &FrpcHandler{
		app:     app,
		service: service,
	}
}

func (h *FrpcHandler) RegisterHandlers(e *core.ServeEvent) {
	e.Router.POST("/api/frpc/launch", requireScope(apikey.ScopeWrite, func(e *core.RequestEvent) error {
		data := struct {
			ID string `json:"id"`
		}{}
		if err := e.BindBody(&data); err != nil {
			return e.JSON(400, map[string]string{"error": "invalid request body"})
		}
		id := data.ID
		if id == "" {
			return e.JSON(400, map[string]string{"error": "id is required"})
		}
		if !validID.MatchString(id) {
			return e.JSON(400, map[string]string{"error": "invalid id format"})
		}
		err := h.service.LaunchFrpc(&id)
		if errors.Is(err, frpc.ErrAlreadyRunning) || errors.Is(err, frpc.ErrLaunchCancelled) {
			return e.JSON(http.StatusConflict, map[string]string{"error": err.Error()})
		}
		if err != nil {
			return e.JSON(500, map[string]string{"error": err.Error()})
		}
		return e.JSON(200, map[string]string{"message": "frpc started"})
	}))

	// Download today's log of a server, or of all servers with id=all.
	e.Router.GET("/api/frpc/logs/download", requireAuth(func(e *core.RequestEvent) error {
		id := e.Request.URL.Query().Get("id")
		if id != frpc.AllServers && !validID.MatchString(id) {
			return e.JSON(400, map[string]string{"error": "invalid id format"})
		}
		if err := http.NewResponseController(e.Response).SetWriteDeadline(time.Time{}); err != nil && !errors.Is(err, http.ErrNotSupported) {
			return e.JSON(500, map[string]string{"error": "failed to start the download"})
		}
		e.Response.Header().Set("Content-Type", "text/plain; charset=utf-8")
		e.Response.Header().Set("Content-Disposition", `attachment; filename="frpc-`+id+`-`+time.Now().Format("20060102")+`.log"`)
		err := h.service.WriteLog(id, e.Response)
		if errors.Is(err, frpc.ErrLogNotFound) {
			return e.JSON(http.StatusNotFound, map[string]string{"error": err.Error()})
		}
		return err
	}))

	e.Router.GET("/api/frpc/logs/stream", requireAuth(func(e *core.RequestEvent) error {
		id := e.Request.URL.Query().Get("id")
		if id == "" {
			return e.JSON(400, map[string]string{"error": "id is required"})
		}
		if id != frpc.AllServers && !validID.MatchString(id) {
			return e.JSON(400, map[string]string{"error": "invalid id format"})
		}

		w := e.Response
		// Lift PocketBase's 5-minute server WriteTimeout for this long-lived stream,
		// as its own realtime endpoint does; otherwise the log view drops every 5 minutes.
		if err := http.NewResponseController(w).SetWriteDeadline(time.Time{}); err != nil && !errors.Is(err, http.ErrNotSupported) {
			return e.JSON(500, map[string]string{"error": "failed to initialize log stream"})
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		flusher, ok := w.(http.Flusher)
		if !ok {
			return e.JSON(500, map[string]string{"error": "streaming not supported"})
		}

		// The SSE headers above aren't sent until the first write, so errors can still be JSON.
		err := h.service.StreamLog(id, e.Request.Context(), w, flusher)
		if errors.Is(err, frpc.ErrLogNotFound) {
			return e.JSON(http.StatusNotFound, map[string]string{"error": err.Error()})
		}
		if err != nil {
			return e.JSON(500, map[string]string{"error": err.Error()})
		}
		return nil
	}))

	// Export a server's config as frpc.toml; secrets=1 keeps tokens and secret keys.
	e.Router.GET("/api/frpc/export", requireAuth(func(e *core.RequestEvent) error {
		id := e.Request.URL.Query().Get("id")
		if !validID.MatchString(id) {
			return e.JSON(400, map[string]string{"error": "invalid id format"})
		}
		if _, err := h.app.FindRecordById("fh_servers", id); err != nil {
			return e.JSON(http.StatusNotFound, map[string]string{"error": "server not found"})
		}
		includeSecrets := e.Request.URL.Query().Get("secrets") == "1"
		out, err := h.service.ExportToml(id, includeSecrets)
		if err != nil {
			return e.JSON(500, map[string]string{"error": err.Error()})
		}
		e.Response.Header().Set("Content-Disposition", `attachment; filename="frpc-`+id+`.toml"`)
		e.Response.Header().Set("Cache-Control", "no-store")
		return e.Blob(http.StatusOK, "application/toml; charset=utf-8", out)
	}))

	e.Router.POST("/api/frpc/terminate", requireScope(apikey.ScopeWrite, func(e *core.RequestEvent) error {
		data := struct {
			ID string `json:"id"`
		}{}
		if err := e.BindBody(&data); err != nil {
			return e.JSON(400, map[string]string{"error": "invalid request body"})
		}
		id := data.ID
		if id == "" {
			return e.JSON(400, map[string]string{"error": "id is required"})
		}
		if !validID.MatchString(id) {
			return e.JSON(400, map[string]string{"error": "invalid id format"})
		}
		err := h.service.TerminateFrpc(&id)
		if err != nil {
			return e.JSON(500, map[string]string{"error": err.Error()})
		}
		return e.JSON(200, map[string]string{"message": "frpc terminated"})
	}))

	e.Router.POST("/api/frpc/reload", requireScope(apikey.ScopeWrite, func(e *core.RequestEvent) error {
		data := struct {
			ID string `json:"id"`
		}{}
		if err := e.BindBody(&data); err != nil {
			return e.JSON(400, map[string]string{"error": "invalid request body"})
		}
		id := data.ID
		if id == "" {
			return e.JSON(400, map[string]string{"error": "id is required"})
		}
		if !validID.MatchString(id) {
			return e.JSON(400, map[string]string{"error": "invalid id format"})
		}
		// Only reload if the server is currently running
		if !h.service.IsServerRunning(id) {
			return e.JSON(200, map[string]string{"message": "server not running, skipped"})
		}
		err := h.service.ReloadFrpc(&id)
		if err != nil {
			return e.JSON(500, map[string]string{"error": err.Error()})
		}
		return e.JSON(200, map[string]string{"message": "frpc reloaded"})
	}))
}
