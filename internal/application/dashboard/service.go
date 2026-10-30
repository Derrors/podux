package dashboard

import (
	"context"

	"podux/internal/application/monitoring"
	proxyapp "podux/internal/application/proxy"
	serverapp "podux/internal/application/server"
	proxydomain "podux/internal/domain/proxy"
	serverdomain "podux/internal/domain/server"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

type DashboardStats struct {
	RunningCount         int64
	StoppedCount         int64
	ProxiesEnabledCount  int64
	ProxiesDisabledCount int64
	ProxiesOnlineCount   int64
	MaxLatency           int64
	ProxyTypeCounts      map[string]int64
	UptimeSeconds        int64
	VisitorsTotal        int64
	VisitorsEnabled      int64
	// Traffic is today's frps traffic summed over servers with a dashboard configured;
	// TrafficServers counts them (0 = no traffic data).
	TrafficIn      int64
	TrafficOut     int64
	TrafficServers int
}

type TopologyServerItem struct {
	ID         string `json:"id" db:"id"`
	ServerName string `json:"serverName" db:"serverName"`
	ServerAddr string `json:"serverAddr" db:"serverAddr"`
	BootStatus string `json:"bootStatus" db:"bootStatus"`
}

type TopologyProxyItem struct {
	ID         string `json:"id" db:"id"`
	Name       string `json:"name" db:"name"`
	ProxyType  string `json:"proxyType" db:"proxyType"`
	LocalIP    string `json:"localIP" db:"localIP"`
	LocalPort  int    `json:"localPort" db:"localPort"`
	RemotePort int    `json:"remotePort" db:"remotePort"`
	Status     string `json:"status" db:"status"`
	BootStatus string `json:"bootStatus" db:"bootStatus"`
	ServerID   string `json:"serverId" db:"serverId"`
}

type TopologyVisitorItem struct {
	ID          string `json:"id" db:"id"`
	Name        string `json:"name" db:"name"`
	VisitorType string `json:"visitorType" db:"visitorType"`
	ServerName  string `json:"serverName" db:"serverName"`
	BindAddr    string `json:"bindAddr" db:"bindAddr"`
	BindPort    int    `json:"bindPort" db:"bindPort"`
	Status      string `json:"status" db:"status"`
	ServerID    string `json:"serverId" db:"serverId"`
}

type TopologyData struct {
	Servers  []TopologyServerItem  `json:"servers"`
	Proxies  []TopologyProxyItem   `json:"proxies"`
	Visitors []TopologyVisitorItem `json:"visitors"`
}

type Service struct {
	app           core.App
	serverService *serverapp.Service
	proxyService  *proxyapp.Service
	metrics       *monitoring.MetricsService
	frps          *monitoring.FrpsService
	startTime     time.Time
}

func NewService(app core.App, serverService *serverapp.Service, proxyService *proxyapp.Service, metrics *monitoring.MetricsService, frps *monitoring.FrpsService) *Service {
	return &Service{
		frps:          frps,
		app:           app,
		serverService: serverService,
		proxyService:  proxyService,
		metrics:       metrics,
		startTime:     time.Now(),
	}
}

func (s *Service) GetStats() (*DashboardStats, error) {
	runningCount, err := s.serverService.GetServerCountByStatus(serverdomain.ServerStatusRunning)
	if err != nil {
		return nil, err
	}

	stoppedCount, err := s.serverService.GetServerCountByStatus(serverdomain.ServerStatusStopped)
	if err != nil {
		return nil, err
	}

	proxiesEnabledCount, err := s.proxyService.GetProxyCountByStatus(proxydomain.ProxyStatusEnabled)
	if err != nil {
		return nil, err
	}

	proxiesDisabledCount, err := s.proxyService.GetProxyCountByStatus(proxydomain.ProxyStatusDisabled)
	if err != nil {
		return nil, err
	}

	proxiesOnlineCount, err := s.proxyService.GetProxyCountByBootStatus(proxydomain.ProxyBootStatusOnline)
	if err != nil {
		return nil, err
	}

	maxLatency, err := s.metrics.MaxLatestLatency()
	if err != nil {
		return nil, err
	}

	proxyTypeCounts, err := s.proxyService.GetProxyCountsByType()
	if err != nil {
		return nil, err
	}

	var visitors struct {
		Total   int64 `db:"total"`
		Enabled int64 `db:"enabled"`
	}
	if err := s.app.DB().NewQuery("SELECT COUNT(*) AS total, COALESCE(SUM(status = 'enabled'), 0) AS enabled FROM fh_visitors").One(&visitors); err != nil {
		return nil, err
	}

	stats := &DashboardStats{
		VisitorsTotal:        visitors.Total,
		VisitorsEnabled:      visitors.Enabled,
		RunningCount:         runningCount,
		StoppedCount:         stoppedCount,
		ProxiesEnabledCount:  proxiesEnabledCount,
		ProxiesDisabledCount: proxiesDisabledCount,
		ProxiesOnlineCount:   proxiesOnlineCount,
		MaxLatency:           maxLatency,
		ProxyTypeCounts:      proxyTypeCounts,
		UptimeSeconds:        int64(time.Since(s.startTime).Seconds()),
	}

	if s.frps != nil {
		var ids []string
		if err := s.app.DB().Select("id").From("fh_servers").Column(&ids); err == nil {
			for _, id := range ids {
				if st, _ := s.frps.ServerStats(context.Background(), id); st != nil && st.Info != nil {
					stats.TrafficIn += st.Info.TotalTrafficIn
					stats.TrafficOut += st.Info.TotalTrafficOut
					stats.TrafficServers++
				}
			}
		}
	}
	return stats, nil
}

func (s *Service) GetTopology() (*TopologyData, error) {
	var servers []TopologyServerItem
	if err := s.app.DB().Select("id", "serverName", "serverAddr", "bootStatus").From("fh_servers").All(&servers); err != nil {
		return nil, err
	}
	if servers == nil {
		servers = []TopologyServerItem{}
	}

	var proxies []TopologyProxyItem
	if err := s.app.DB().Select("id", "name", "proxyType", "localIP", "localPort", "remotePort", "status", "bootStatus", "serverId").From("fh_proxies").All(&proxies); err != nil {
		return nil, err
	}
	if proxies == nil {
		proxies = []TopologyProxyItem{}
	}

	var visitors []TopologyVisitorItem
	if err := s.app.DB().Select("id", "name", "visitorType", "serverName", "bindAddr", "bindPort", "status", "serverId").From("fh_visitors").All(&visitors); err != nil {
		return nil, err
	}
	if visitors == nil {
		visitors = []TopologyVisitorItem{}
	}

	return &TopologyData{Servers: servers, Proxies: proxies, Visitors: visitors}, nil
}
