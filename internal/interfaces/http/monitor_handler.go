package httphandler

import (
	"context"
	"errors"
	"net/http"
	"time"

	"podux/internal/application/apikey"
	"podux/internal/application/monitoring"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// MonitorHandler serves frps dashboard stats and external probe results.
type MonitorHandler struct {
	app   core.App
	frps  *monitoring.FrpsService
	probe *monitoring.ProbeService
}

func NewMonitorHandler(app core.App, frps *monitoring.FrpsService, probe *monitoring.ProbeService) *MonitorHandler {
	return &MonitorHandler{app: app, frps: frps, probe: probe}
}

// proxyStatus combines a proxy's frps traffic and its latest external probe.
type proxyStatus struct {
	Traffic *monitoring.ProxyTraffic `json:"traffic,omitempty"`
	Probe   *monitoring.ProbeResult  `json:"probe,omitempty"`
}

func (h *MonitorHandler) RegisterHandlers(e *core.ServeEvent) {
	// Per-proxy traffic and reachability, for one server (?serverId=) or all of them.
	e.Router.GET("/api/proxies/status", requireScope(apikey.ScopeRead, func(e *core.RequestEvent) error {
		serverID := e.Request.URL.Query().Get("serverId")
		var ids []string
		if serverID != "" {
			if !validID.MatchString(serverID) {
				return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid id format"})
			}
			ids = []string{serverID}
		} else if err := h.app.DB().Select("id").From("fh_servers").Column(&ids); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}

		out := map[string]*proxyStatus{}
		get := func(id string) *proxyStatus {
			if out[id] == nil {
				out[id] = &proxyStatus{}
			}
			return out[id]
		}
		dashboards := map[string]string{} // server ID -> error, for servers with a dashboard
		for _, id := range ids {
			stats, err := h.frps.ServerStats(e.Request.Context(), id)
			if err != nil || stats == nil {
				continue
			}
			dashboards[id] = stats.Error
			for pid, t := range stats.Proxies {
				get(pid).Traffic = &t
			}
		}
		for pid, r := range h.probe.Results() {
			get(pid).Probe = &r
		}
		return e.JSON(http.StatusOK, map[string]any{"proxies": out, "dashboards": dashboards})
	}))

	// frps info and today's totals for one server; empty when no dashboard is configured.
	e.Router.GET("/api/servers/{id}/frps", requireAuth(func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if !validID.MatchString(id) {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid id format"})
		}
		stats, err := h.frps.ServerStats(e.Request.Context(), id)
		if err != nil {
			return e.JSON(http.StatusNotFound, map[string]string{"error": "server not found"})
		}
		if stats == nil {
			return e.JSON(http.StatusOK, map[string]any{"configured": false})
		}
		return e.JSON(http.StatusOK, map[string]any{"configured": true, "info": stats.Info, "error": stats.Error})
	}))

	// Check a dashboard address and login from the server form before saving.
	e.Router.POST("/api/servers/frps-test", requireAuth(func(e *core.RequestEvent) error {
		var cfg monitoring.DashboardConfig
		if err := e.BindBody(&cfg); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		}
		ctx, cancel := context.WithTimeout(e.Request.Context(), 10*time.Second)
		defer cancel()
		info, err := h.frps.TestDashboard(ctx, cfg)
		if err != nil {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, info)
	}))

	// A proxy's last 7 days of traffic from frps.
	e.Router.GET("/api/proxies/{id}/traffic", requireAuth(func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if !validID.MatchString(id) {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid id format"})
		}
		h7, err := h.frps.ProxyHistory(e.Request.Context(), id)
		switch {
		case errors.Is(err, monitoring.ErrNoDashboard):
			return e.JSON(http.StatusNotFound, map[string]string{"error": err.Error()})
		case err != nil:
			return e.JSON(http.StatusBadGateway, map[string]string{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, h7)
	}))
}
