package httphandler

import (
	"net/http"

	"podux/internal/application/notify"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

type NotifyHandler struct {
	service *notify.Service
}

func NewNotifyHandler(service *notify.Service) *NotifyHandler {
	return &NotifyHandler{service: service}
}

// testResult is one channel's outcome of a test notification.
type testResult struct {
	Channel string `json:"channel"`
	OK      bool   `json:"ok"`
	Error   string `json:"error,omitempty"`
}

func (h *NotifyHandler) RegisterHandlers(e *core.ServeEvent) {
	e.Router.GET("/api/notifications", requireAuth(func(e *core.RequestEvent) error {
		settings, err := h.service.GetSettings()
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, settings)
	}))

	e.Router.PUT("/api/notifications", requireAuth(func(e *core.RequestEvent) error {
		var settings notify.Settings
		if err := e.BindBody(&settings); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		}
		if err := h.service.SaveSettings(settings); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, settings)
	}))

	// Send a test message with the posted settings, which need not be saved yet.
	e.Router.POST("/api/notifications/test", requireAuth(func(e *core.RequestEvent) error {
		var settings notify.Settings
		if err := e.BindBody(&settings); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		}
		results, err := h.service.SendTest(settings)
		if err != nil {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}
		out := make([]testResult, 0, len(results))
		for _, channel := range []string{"webhook", "telegram", "bark", "email"} {
			err, ok := results[channel]
			if !ok {
				continue
			}
			r := testResult{Channel: channel, OK: err == nil}
			if err != nil {
				r.Error = err.Error()
			}
			out = append(out, r)
		}
		return e.JSON(http.StatusOK, out)
	}))
}
