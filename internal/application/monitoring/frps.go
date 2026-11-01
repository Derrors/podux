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

// TrafficHistory is a proxy's daily traffic for the last 7 days, newest first (index 0 = today).
type TrafficHistory struct {
	TrafficIn  []int64 `json:"trafficIn"`
	TrafficOut []int64 `json:"trafficOut"`
}

// ServerStats is what Podux shows for a server from its frps dashboard.
type ServerStats struct {
	Info *FrpsInfo `json:"info,omitempty"`
	// Proxies maps Podux proxy IDs to their frps stats.
	Proxies      map[string]ProxyTraffic `json:"proxies"`
	Error        string                  `json:"error,omitempty"`
	Fetched      time.Time               `json:"fetched"`
	LastAttempt  time.Time               `json:"lastAttempt"`
	RefreshState string                  `json:"refreshState"` // idle, queued, refreshing, stopped
}

// statsTTL limits dashboard calls: every open proxy list polls the stats.
const statsTTL = 15 * time.Second

// FrpsService reads traffic and server info from frps dashboards (frps's webServer
// API, available in all frps versions Podux supports).
type FrpsService struct {
	app    core.App
	client *http.Client

	mu      sync.Mutex
	cache   map[string]*frpsEntry
	ctx     context.Context
	cancel  context.CancelFunc
	started bool
	workers sync.WaitGroup
	queue   chan frpsJob
}

type frpsEntry struct {
	cfg    DashboardConfig
	user   string
	stats  ServerStats
	done   chan struct{}
	cancel context.CancelFunc
}
type frpsJob struct {
	id    string
	entry *frpsEntry
}

func NewFrpsService(app core.App) *FrpsService {
	ctx, cancel := context.WithCancel(context.Background())
	return &FrpsService{app: app, client: &http.Client{Timeout: 8 * time.Second}, cache: map[string]*frpsEntry{}, ctx: ctx, cancel: cancel, queue: make(chan frpsJob, 128)}
}

// Start runs a fixed-size remote-I/O pool and refreshes all configured servers.
// ServerStats also starts it lazily for callers not using the application lifecycle.
func (s *FrpsService) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.started || s.ctx.Err() != nil {
		return
	}
	s.started = true
	for range 4 {
		s.workers.Add(1)
		go func() {
			defer s.workers.Done()
			for {
				select {
				case <-s.ctx.Done():
					return
				case job := <-s.queue:
					s.refresh(job)
				}
			}
		}()
	}
	s.workers.Add(1)
	go func() {
		defer s.workers.Done()
		ticker := time.NewTicker(statsTTL)
		defer ticker.Stop()
		for {
			if err := eachServer(s.ctx, s.app, func(r *core.Record) {
				var cfg DashboardConfig
				_ = r.UnmarshalJSONField("dashboard", &cfg)
				s.schedule(r.Id, cfg, r.GetString("user"), true)
			}); err != nil && s.ctx.Err() == nil {
				s.app.Logger().Warn("Refresh frps dashboards", "error", err)
			}
			select {
			case <-s.ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

// Stop cancels remote calls and waits for all owned goroutines, including scans.
func (s *FrpsService) Stop() {
	s.mu.Lock()
	s.cancel()
	for _, e := range s.cache {
		s.cancelEntry(e)
		e.stats.RefreshState = "stopped"
	}
	s.mu.Unlock()
	s.workers.Wait()
}

func (s *FrpsService) cancelEntry(e *frpsEntry) {
	if e.cancel != nil {
		e.cancel()
	}
	if e.done != nil {
		close(e.done)
		e.done = nil
	}
}

// RegisterHooks invalidates credentials, mappings and deleted servers immediately.
func (s *FrpsService) RegisterHooks() {
	s.app.OnRecordAfterUpdateSuccess("fh_servers").BindFunc(func(e *core.RecordEvent) error {
		old := e.Record.Original()
		if e.Record.GetString("dashboard") != old.GetString("dashboard") || e.Record.GetString("user") != old.GetString("user") || e.Record.GetString("serverAddr") != old.GetString("serverAddr") {
			s.ForgetServer(e.Record.Id)
		}
		return e.Next()
	})
	s.app.OnRecordAfterDeleteSuccess("fh_servers").BindFunc(func(e *core.RecordEvent) error { s.ForgetServer(e.Record.Id); return e.Next() })
	invalidateProxy := func(e *core.RecordEvent) error {
		s.ForgetServer(e.Record.GetString("serverId"))
		if old := e.Record.Original().GetString("serverId"); old != "" && old != e.Record.GetString("serverId") {
			s.ForgetServer(old)
		}
		return e.Next()
	}
	s.app.OnRecordAfterCreateSuccess("fh_proxies").BindFunc(invalidateProxy)
	s.app.OnRecordAfterDeleteSuccess("fh_proxies").BindFunc(invalidateProxy)
	s.app.OnRecordAfterUpdateSuccess("fh_proxies").BindFunc(func(e *core.RecordEvent) error {
		old := e.Record.Original()
		if e.Record.GetString("serverId") != old.GetString("serverId") || e.Record.GetString("name") != old.GetString("name") || e.Record.GetString("proxyType") != old.GetString("proxyType") {
			return invalidateProxy(e)
		}
		return e.Next()
	})
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

// ServerStats never waits for remote I/O. Cold reads return an empty snapshot with
// refreshState; stale reads retain the last successful data, even after a failure.
// The request context never owns a refresh and therefore cannot poison its cache.
func (s *FrpsService) ServerStats(ctx context.Context, serverID string) (*ServerStats, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	cfg, user, err := s.dashboard(serverID)
	if err != nil {
		s.ForgetServer(serverID)
		return nil, err
	}
	if cfg.Configured() {
		s.Start()
	}
	s.schedule(serverID, cfg, user, false)
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.cache[serverID]
	if e == nil {
		return nil, nil
	}
	out := e.stats
	out.Proxies = make(map[string]ProxyTraffic, len(e.stats.Proxies))
	for id, p := range e.stats.Proxies {
		out.Proxies[id] = p
	}
	if out.Info != nil {
		info := *out.Info
		out.Info = &info
	}
	return &out, nil
}

func (s *FrpsService) schedule(id string, cfg DashboardConfig, user string, wait bool) {
	s.mu.Lock()
	e := s.cache[id]
	if e != nil && (e.cfg != cfg || e.user != user || !cfg.Configured()) {
		s.cancelEntry(e)
		delete(s.cache, id)
		e = nil
	}
	if !cfg.Configured() {
		s.mu.Unlock()
		return
	}
	if e == nil {
		e = &frpsEntry{cfg: cfg, user: user, stats: ServerStats{Proxies: map[string]ProxyTraffic{}, RefreshState: "idle"}}
		s.cache[id] = e
	}
	if s.ctx.Err() != nil {
		e.stats.RefreshState = "stopped"
		s.mu.Unlock()
		return
	}
	if e.done != nil || time.Since(e.stats.LastAttempt) < statsTTL {
		s.mu.Unlock()
		return
	}
	e.done = make(chan struct{})
	e.stats.RefreshState = "queued"
	s.mu.Unlock()
	job := frpsJob{id, e}
	if wait {
		select {
		case s.queue <- job:
			return
		case <-s.ctx.Done():
		}
	} else {
		select {
		case s.queue <- job:
			return
		default:
		}
	}
	s.mu.Lock()
	if s.cache[id] == e {
		s.cancelEntry(e)
		e.stats.RefreshState = "idle"
	}
	s.mu.Unlock()
}

// ReadyStats is for background consumers requiring remote ports before probing.
// Unlike ServerStats it waits for the shared refresh, without canceling it when a
// caller leaves. Never call it from dashboard/status/metrics HTTP handlers.
func (s *FrpsService) ReadyStats(ctx context.Context, id string) (*ServerStats, error) {
	for {
		stats, err := s.ServerStats(ctx, id)
		if err != nil || stats == nil || stats.Info != nil {
			return stats, err
		}
		if stats.Error != "" {
			return stats, errors.New(stats.Error)
		}
		s.mu.Lock()
		var done <-chan struct{}
		if e := s.cache[id]; e != nil {
			done = e.done
		}
		s.mu.Unlock()
		timer := time.NewTimer(100 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-s.ctx.Done():
			timer.Stop()
			return nil, s.ctx.Err()
		case <-done:
			timer.Stop()
		case <-timer.C:
		}
	}
}

func (s *FrpsService) refresh(job frpsJob) {
	s.mu.Lock()
	e := job.entry
	if s.ctx.Err() != nil || s.cache[job.id] != e || e.done == nil {
		s.mu.Unlock()
		return
	}
	ctx, cancel := context.WithTimeout(s.ctx, 20*time.Second)
	e.cancel = cancel
	e.stats.RefreshState = "refreshing"
	e.stats.LastAttempt = time.Now().UTC()
	s.mu.Unlock()
	defer cancel()
	stats, err := s.fetchStats(ctx, job.id, e.cfg, e.user)
	cfg, user, configErr := s.dashboard(job.id)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cache[job.id] != e {
		return
	}
	if s.ctx.Err() != nil {
		s.cancelEntry(e)
		e.stats.RefreshState = "stopped"
		return
	}
	if configErr != nil || cfg != e.cfg || user != e.user {
		s.cancelEntry(e)
		delete(s.cache, job.id)
		return
	}
	if err != nil {
		e.stats.Error = err.Error()
	} else {
		e.stats.Error = stats.Error
		if stats.Info != nil {
			e.stats.Info = stats.Info
			if stats.Error == "" {
				e.stats.Proxies = stats.Proxies
				e.stats.Fetched = time.Now().UTC()
			} else {
				// A failed proxy-type endpoint must not erase its old traffic.
				for id, value := range stats.Proxies {
					e.stats.Proxies[id] = value
				}
			}
		}
	}
	s.cancelEntry(e)
	e.stats.RefreshState = "idle"
}

func (s *FrpsService) fetchStats(ctx context.Context, serverID string, cfg DashboardConfig, user string) (*ServerStats, error) {
	stats := &ServerStats{Proxies: map[string]ProxyTraffic{}}
	var info FrpsInfo
	if err := s.get(ctx, cfg, "/api/serverinfo", &info); err != nil {
		return nil, err
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
	if e := s.cache[serverID]; e != nil {
		s.cancelEntry(e)
	}
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
