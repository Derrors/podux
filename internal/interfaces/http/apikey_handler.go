package httphandler

import (
	"bytes"
	"errors"
	"net/http"

	"podux/internal/application/apikey"
	"podux/internal/application/monitoring"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

type APIKeyHandler struct {
	keys     *apikey.Service
	exporter *monitoring.Exporter
}

func NewAPIKeyHandler(keys *apikey.Service, exporter *monitoring.Exporter) *APIKeyHandler {
	return &APIKeyHandler{keys: keys, exporter: exporter}
}

func (h *APIKeyHandler) RegisterHandlers(e *core.ServeEvent) {
	// Key management needs a signed-in user; an API key cannot manage keys.
	e.Router.GET("/api/api-keys", requireAuth(func(e *core.RequestEvent) error {
		keys, err := h.keys.List()
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, keys)
	}))

	// The token is in this response only; Podux keeps just its hash.
	e.Router.POST("/api/api-keys", requireAuth(func(e *core.RequestEvent) error {
		var body struct {
			Name  string `json:"name"`
			Scope string `json:"scope"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		}
		key, token, err := h.keys.Create(body.Name, body.Scope)
		if errors.Is(err, apikey.ErrInvalidName) || errors.Is(err, apikey.ErrInvalidScope) {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]any{"key": key, "token": token})
	}))

	e.Router.DELETE("/api/api-keys/{id}", requireAuth(func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if !validID.MatchString(id) {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid id format"})
		}
		if err := h.keys.Delete(id); errors.Is(err, apikey.ErrNotFound) {
			return e.JSON(http.StatusNotFound, map[string]string{"error": err.Error()})
		} else if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return e.NoContent(http.StatusNoContent)
	}))

	// Prometheus scrape endpoint.
	e.Router.GET("/api/metrics", requireScope(apikey.ScopeRead, func(e *core.RequestEvent) error {
		var buf bytes.Buffer
		if err := h.exporter.Write(e.Request.Context(), &buf); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return e.Blob(http.StatusOK, "text/plain; version=0.0.4; charset=utf-8", buf.Bytes())
	}))
}
