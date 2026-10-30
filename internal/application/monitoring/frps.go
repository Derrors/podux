package monitoring

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// DashboardConfig is fh_servers.dashboard: the frps dashboard (webServer) address and login.
type DashboardConfig struct {
	URL      string `json:"url"`
	User     string `json:"user"`
	Password string `json:"password"`
}

// Configured reports whether a dashboard URL is set.
func (c DashboardConfig) Configured() bool { return strings.TrimSpace(c.URL) != "" }

// FrpsInfo is the part of frps's /api/serverinfo Podux uses. Traffic counts are today's.
type FrpsInfo struct {
	Version               string `json:"version"`
	VhostHTTPPort         int    `json:"vhostHTTPPort"`
	VhostHTTPSPort        int    `json:"vhostHTTPSPort"`
	TCPMuxHTTPConnectPort int    `json:"tcpmuxHTTPConnectPort"`
	SubdomainHost         string `json:"subdomainHost"`
	TotalTrafficIn        int64  `json:"totalTrafficIn"`
	TotalTrafficOut       int64  `json:"totalTrafficOut"`
	CurConns              int64  `json:"curConns"`
	ClientCounts          int64  `json:"clientCounts"`
}

// ProxyTraffic is one proxy's stats on frps today.
type ProxyTraffic struct {
	TodayTrafficIn  int64  `json:"todayTrafficIn"`
	TodayTrafficOut int64  `json:"todayTrafficOut"`
	CurConns        int64  `json:"curConns"`
	Status          string `json:"status"`
}

// TrafficHistory is a proxy's daily traffic for the last 7 days, oldest first.
type TrafficHistory struct {
	TrafficIn  []int64 `json:"trafficIn"`
	TrafficOut []int64 `json:"trafficOut"`
}

// ServerStats is what Podux shows for a server from its frps dashboard.
type ServerStats struct {
	Info *FrpsInfo `json:"info,omitempty"`
	// Proxies maps Podux proxy IDs to their frps stats.
	Proxies map[string]ProxyTraffic `json:"proxies"`
	Error   string                  `json:"error,omitempty"`
	Fetched time.Time               `json:"fetched"`
}

// statsTTL limits dashboard calls: every open proxy list polls the stats.
const statsTTL = 15 * time.Second

// FrpsService reads traffic and server info from frps dashboards (frps's webServer
// API, available in all frps versions Podux supports).
type FrpsService struct {
	app    core.App
	client *http.Client

	mu    sync.Mutex
	cache map[string]*ServerStats
}

func NewFrpsService(app core.App) *FrpsService {
	return &FrpsService{app: app, client: &http.Client{Timeout: 8 * time.Second}, cache: map[string]*ServerStats{}}
}

// dashboard returns a server's dashboard config, and the frps user prefix of its proxies.
func (s *FrpsService) dashboard(serverID string) (DashboardConfig, string, error) {
	var cfg DashboardConfig
	r, err := s.app.FindRecordById("fh_servers", serverID)
	if err != nil {
		return cfg, "", err
	}
	_ = r.UnmarshalJSONField("dashboard", &cfg)
	return cfg, r.GetString("user"), nil
}

// get calls a dashboard API path and decodes the JSON answer into out.
func (s *FrpsService) get(ctx context.Context, cfg DashboardConfig, path string, out any) error {
	base := strings.TrimRight(strings.TrimSpace(cfg.URL), "/")
	if u, err := url.Parse(base); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errors.New("dashboard URL must be an http(s) URL")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+path, nil)
	if err != nil {
		return err
	}
	if cfg.User != "" || cfg.Password != "" {
		req.SetBasicAuth(cfg.User, cfg.Password)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	switch {
	case resp.StatusCode == http.StatusUnauthorized:
		return errors.New("dashboard login failed (HTTP 401)")
	case resp.StatusCode != http.StatusOK:
		return fmt.Errorf("dashboard answered HTTP %d", resp.StatusCode)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("unexpected dashboard answer: %w", err)
	}
	return nil
}

// TestDashboard checks a dashboard config and returns frps's server info.
func (s *FrpsService) TestDashboard(ctx context.Context, cfg DashboardConfig) (*FrpsInfo, error) {
	var info FrpsInfo
	if err := s.get(ctx, cfg, "/api/serverinfo", &info); err != nil {
		return nil, err
	}
	return &info, nil
}

// ServerStats returns a server's frps info and per-proxy traffic, cached for statsTTL.
// A server without a dashboard config returns nil.
func (s *FrpsService) ServerStats(ctx context.Context, serverID string) (*ServerStats, error) {
	s.mu.Lock()
	if c := s.cache[serverID]; c != nil && time.Since(c.Fetched) < statsTTL {
		s.mu.Unlock()
		return c, nil
	}
	s.mu.Unlock()

	cfg, user, err := s.dashboard(serverID)
	if err != nil {
		return nil, err
	}
	if !cfg.Configured() {
		return nil, nil
	}

	stats := &ServerStats{Proxies: map[string]ProxyTraffic{}, Fetched: time.Now()}
	defer func() {
		s.mu.Lock()
		s.cache[serverID] = stats
		s.mu.Unlock()
	}()

	var info FrpsInfo
	if err := s.get(ctx, cfg, "/api/serverinfo", &info); err != nil {
		stats.Error = err.Error()
		return stats, nil
	}
	stats.Info = &info

	var proxies []struct {
		Id        string `db:"id"`
		Name      string `db:"name"`
		ProxyType string `db:"proxyType"`
	}
	if err := s.app.DB().Select("id", "name", "proxyType").From("fh_proxies").
		Where(dbx.HashExp{"serverId": serverID}).All(&proxies); err != nil {
		return nil, err
	}
	byFrpsName := map[string]string{}
	types := map[string]bool{}
	for _, p := range proxies {
		byFrpsName[FrpsProxyName(user, p.Name, p.Id)] = p.Id
		types[p.ProxyType] = true
	}
	for t := range types {
		var resp struct {
			Proxies []struct {
				Name string `json:"name"`
				ProxyTraffic
			} `json:"proxies"`
		}
		if err := s.get(ctx, cfg, "/api/proxy/"+url.PathEscape(t), &resp); err != nil {
			stats.Error = err.Error()
			continue
		}
		for _, p := range resp.Proxies {
			if id, ok := byFrpsName[p.Name]; ok {
				stats.Proxies[id] = p.ProxyTraffic
			}
		}
	}
	return stats, nil
}

// ProxyHistory returns a proxy's last 7 days of traffic from its server's frps.
func (s *FrpsService) ProxyHistory(ctx context.Context, proxyID string) (*TrafficHistory, error) {
	p, err := s.app.FindRecordById("fh_proxies", proxyID)
	if err != nil {
		return nil, err
	}
	cfg, user, err := s.dashboard(p.GetString("serverId"))
	if err != nil {
		return nil, err
	}
	if !cfg.Configured() {
		return nil, ErrNoDashboard
	}
	var h TrafficHistory
	name := FrpsProxyName(user, p.GetString("name"), p.Id)
	if err := s.get(ctx, cfg, "/api/traffic/"+url.PathEscape(name), &h); err != nil {
		return nil, err
	}
	return &h, nil
}

// ForgetServer drops a deleted server's cached stats.
func (s *FrpsService) ForgetServer(serverID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.cache, serverID)
}

// ErrNoDashboard means the proxy's server has no frps dashboard configured.
var ErrNoDashboard = errors.New("no frps dashboard configured for this server")

// FrpsProxyName is how frps names a Podux proxy: "<user>.<name>-<id>", without
// "<user>." when the server sets no user.
func FrpsProxyName(user, name, id string) string {
	n := name + "-" + id
	if user != "" {
		n = user + "." + n
	}
	return n
}
