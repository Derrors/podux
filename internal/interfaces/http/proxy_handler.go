package httphandler

import (
	"errors"
	"net/http"

	"podux/internal/application/apikey"
	"podux/internal/application/proxy"

	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

type ProxyHandler struct {
	app core.App
}

func NewProxyHandler(app core.App) *ProxyHandler {
	return &ProxyHandler{app: app}
}

type batchRequest struct {
	IDs      []string `json:"ids"`
	Action   string   `json:"action"`
	ServerID string   `json:"serverId"`
}

func (h *ProxyHandler) RegisterHandlers(e *core.ServeEvent) {
	// Enable, disable, delete or move several proxies at once, all or nothing.
	// A failure names the proxy and, for validation errors such as a port
	// conflict, the field, code and params like PocketBase's own errors.
	e.Router.POST("/api/proxies/batch", requireScope(apikey.ScopeWrite, func(e *core.RequestEvent) error {
		var req batchRequest
		if err := e.BindBody(&req); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		}
		for _, id := range req.IDs {
			if !validID.MatchString(id) {
				return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid id format"})
			}
		}
		n, err := proxy.Batch(h.app, req.IDs, req.Action, req.ServerID)
		if err == nil {
			return e.JSON(http.StatusOK, map[string]int{"count": n})
		}

		var batchErr *proxy.BatchError
		var verrs validation.Errors
		switch {
		case errors.As(err, &batchErr) && errors.As(err, &verrs):
			body := map[string]any{"error": batchErr.Error(), "proxy": batchErr.ProxyName}
			for field, fe := range verrs {
				body["field"] = field
				if ve, ok := fe.(validation.Error); ok {
					body["code"] = ve.Code()
					body["params"] = ve.Params()
				}
				break
			}
			return e.JSON(http.StatusBadRequest, body)
		case errors.Is(err, proxy.ErrInvalidBatch):
			return e.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		default:
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
	}))
}
