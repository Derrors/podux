package httphandler

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"podux/internal/application/monitoring"
	"podux/pkg/response"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type ServerHandler struct {
	app            core.App
	metricsService *monitoring.MetricsService
}

func NewServerHandler(app core.App, metricsService *monitoring.MetricsService) *ServerHandler {
	return &ServerHandler{app: app, metricsService: metricsService}
}

// serverVO is a list item. Credentials and connection settings (auth, transport
// incl. TLS keys, log, metadatas) are left out; edit forms load the full record.
type serverVO struct {
	ID             string                    `json:"id"`
	ServerName     string                    `json:"serverName"`
	User           string                    `json:"user"`
	ServerAddr     string                    `json:"serverAddr"`
	ServerPort     int                       `json:"serverPort"`
	Description    string                    `json:"description"`
	BootStatus     string                    `json:"bootStatus"`
	AutoConnection bool                      `json:"autoConnection"`
	GeoLocation    any                       `json:"geoLocation,omitempty"`
	Created        string                    `json:"created"`
	Updated        string                    `json:"updated"`
	NetworkStatus  *monitoring.NetworkStatus `json:"networkStatus,omitempty"`
}

type serverListResponse struct {
	Page       int        `json:"page"`
	PerPage    int        `json:"perPage"`
	TotalItems int64      `json:"totalItems"`
	TotalPages int        `json:"totalPages"`
	Items      []serverVO `json:"items"`
}

type serverOptionVO struct {
	ID            string                    `json:"id"`
	ServerName    string                    `json:"serverName"`
	BootStatus    string                    `json:"bootStatus"`
	NetworkStatus *monitoring.NetworkStatus `json:"networkStatus,omitempty"`
}

var likeEscaper = strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`)

type probePoint struct {
	T   string  `json:"t"`
	Val float64 `json:"val"`
}

func (h *ServerHandler) RegisterHandlers(e *core.ServeEvent) {
	// Paginated server list with assembled latency metrics.
	e.Router.GET("/api/servers", requireAuth(func(e *core.RequestEvent) error {
		page, _ := strconv.Atoi(e.Request.URL.Query().Get("page"))
		if page < 1 {
			page = 1
		}
		perPage, _ := strconv.Atoi(e.Request.URL.Query().Get("perPage"))
		if perPage < 1 {
			perPage = 10
		}
		search := e.Request.URL.Query().Get("search")

		// One escaped LIKE expression for both the count and the page. PocketBase's "~"
		// filter can't be used here: it treats a search containing "%" as a raw pattern.
		var where dbx.Expression
		if search != "" {
			where = dbx.NewExp(
				`(serverName LIKE {:s} ESCAPE '\' OR serverAddr LIKE {:s} ESCAPE '\' OR description LIKE {:s} ESCAPE '\')`,
				dbx.Params{"s": "%" + likeEscaper.Replace(search) + "%"},
			)
		}

		var total int64
		if err := h.app.DB().Select("COUNT(*)").From("fh_servers").Where(where).Row(&total); err != nil {
			return e.JSON(500, response.Error(err))
		}

		var records []*core.Record
		err := h.app.RecordQuery("fh_servers").
			Where(where).
			OrderBy("created DESC").
			Limit(int64(perPage)).
			Offset(int64((page - 1) * perPage)).
			All(&records)
		if err != nil {
			return e.JSON(500, response.Error(err))
		}

		latencyMap, err := h.metricsService.GetLatestLatencyBatch()
		if err != nil {
			h.app.Logger().Warn("Failed to get latency batch", "error", err)
			latencyMap = map[string]*monitoring.NetworkStatus{}
		}

		totalPages := int(math.Ceil(float64(total) / float64(perPage)))
		items := make([]serverVO, 0, len(records))
		for _, r := range records {
			items = append(items, serverVO{
				ID:             r.Id,
				ServerName:     r.GetString("serverName"),
				User:           r.GetString("user"),
				ServerAddr:     r.GetString("serverAddr"),
				ServerPort:     r.GetInt("serverPort"),
				Description:    r.GetString("description"),
				BootStatus:     r.GetString("bootStatus"),
				AutoConnection: r.GetBool("autoConnection"),
				GeoLocation:    r.Get("geoLocation"),
				Created:        r.GetString("created"),
				Updated:        r.GetString("updated"),
				NetworkStatus:  latencyMap[r.Id],
			})
		}

		return e.JSON(200, serverListResponse{
			Page:       page,
			PerPage:    perPage,
			TotalItems: total,
			TotalPages: totalPages,
			Items:      items,
		})
	}))

	// Probe history for a single server — last 30 minutes of latency data.
	e.Router.GET("/api/servers/probe-history", requireAuth(func(e *core.RequestEvent) error {
		serverID := e.Request.URL.Query().Get("serverId")
		if serverID == "" {
			return e.JSON(400, response.Error(fmt.Errorf("serverId is required")))
		}

		since := time.Now().UTC().Add(-30 * time.Minute).Format("2006-01-02 15:04:05.000Z")

		type row struct {
			T   string  `db:"t"`
			Val float64 `db:"val"`
		}
		var rows []row
		err := h.app.DB().
			NewQuery(`
				SELECT r.t, r.val
				FROM fh_metrics_raw r
				INNER JOIN fh_metrics_targets t ON r.targetId = t.id
				WHERE t.serverId = {:serverId}
				  AND r.metricKey = {:key}
				  AND r.t >= {:since}
				ORDER BY r.t ASC
				LIMIT 500
			`).
			Bind(dbx.Params{
				"serverId": serverID,
				"key":      monitoring.MetricKeyFrpsDelay,
				"since":    since,
			}).
			All(&rows)
		if err != nil {
			return e.JSON(500, response.Error(err))
		}

		points := make([]probePoint, 0, len(rows))
		for _, r := range rows {
			points = append(points, probePoint(r))
		}
		return e.JSON(200, points)
	}))

	// Flat server list for dropdowns, with latest latency assembled.
	e.Router.GET("/api/servers/options", requireAuth(func(e *core.RequestEvent) error {
		records, err := h.app.FindRecordsByFilter("fh_servers", "", "-created", 500, 0)
		if err != nil {
			return e.JSON(500, response.Error(err))
		}

		latencyMap, err := h.metricsService.GetLatestLatencyBatch()
		if err != nil {
			h.app.Logger().Warn("Failed to get latency batch for options", "error", err)
			latencyMap = map[string]*monitoring.NetworkStatus{}
		}

		items := make([]serverOptionVO, 0, len(records))
		for _, r := range records {
			items = append(items, serverOptionVO{
				ID:            r.Id,
				ServerName:    r.GetString("serverName"),
				BootStatus:    r.GetString("bootStatus"),
				NetworkStatus: latencyMap[r.Id],
			})
		}

		return e.JSON(200, items)
	}))
}
