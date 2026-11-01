package monitoring

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// ProbeInterval is the target interval between external probe rounds. Slow or
// large rounds may take longer; they never overlap or catch up with a burst.
const ProbeInterval = time.Minute

const (
	probeTimeout           = 8 * time.Second
	probeConcurrency       = 4
	probeMinSpacing        = 250 * time.Millisecond
	probeServerConcurrency = 8
	probeGlobalConcurrency = 16
)

// frpsNotFoundMarker is in frps's own 404 page, served when no proxy matches a request.
const frpsNotFoundMarker = "Faithfully yours, frp."

// ProbeResult is the latest external probe of a proxy.
type ProbeResult struct {
	ProxyID   string    `json:"proxyId"`
	Name      string    `json:"name"`
	Endpoint  string    `json:"endpoint"`
	Reachable bool      `json:"reachable"`
	Error     string    `json:"error,omitempty"`
	Checked   time.Time `json:"checked"`
}

// ProbeObserver receives each round's results of one running server.
type ProbeObserver func(serverID, serverName string, results []ProbeResult)

// ProbeService checks from outside that online proxies really answer on their public
// endpoint: a TCP connect for tcp proxies, an HTTP request for http and a TLS
// handshake for https. frpc may report a proxy online while frps or a firewall
// still blocks it. udp, stcp, sudp, xtcp and tcpmux proxies are not probed.
type ProbeService struct {
	app  core.App
	frps *FrpsService

	mu       sync.Mutex
	results  map[string]ProbeResult
	observer ProbeObserver
	started  bool
	workers  sync.WaitGroup // Add is guarded by mu and forbidden after cancellation.
	ctx      context.Context
	cancel   context.CancelFunc
	round    chan struct{} // coalesces concurrent ProbeAll calls
	slots    chan struct{} // process-wide in-flight probes

	// observeMu orders completed batches against opt-out hooks without holding
	// mu while calling the observer (which may read Results).
	observeMu   sync.Mutex
	invalidated map[string]bool // proxy settings changed during the current round
	active      map[string]context.CancelFunc
}

func NewProbeService(app core.App, frps *FrpsService) *ProbeService {
	ctx, cancel := context.WithCancel(context.Background())
	return &ProbeService{
		app: app, frps: frps, results: map[string]ProbeResult{},
		ctx: ctx, cancel: cancel, round: make(chan struct{}, 1), slots: make(chan struct{}, probeGlobalConcurrency),
		invalidated: map[string]bool{}, active: map[string]context.CancelFunc{},
	}
}

// SetObserver registers fn; call it before Start.
func (s *ProbeService) SetObserver(fn ProbeObserver) { s.observer = fn }

// Start schedules non-overlapping rounds until Stop. Calling Start again is a no-op.
func (s *ProbeService) Start() {
	s.mu.Lock()
	if s.started || s.ctx.Err() != nil {
		s.mu.Unlock()
		return
	}
	s.started = true
	s.workers.Add(1)
	s.mu.Unlock()
	go func() {
		defer s.workers.Done()
		timer := time.NewTimer(ProbeInterval)
		defer timer.Stop()
		for {
			select {
			case <-s.ctx.Done():
				return
			case <-timer.C:
				started := time.Now()
				s.ProbeAll(s.ctx)
				// No queued ticker events: a slow round is not followed by a
				// catch-up burst, even if its last TCP probe finished instantly.
				timer.Reset(max(probeMinSpacing, ProbeInterval-time.Since(started)))
			}
		}
	}()
}

// Stop cancels both queued and in-flight probes, then waits for them to exit.
func (s *ProbeService) Stop() {
	s.mu.Lock()
	s.cancel()
	s.mu.Unlock()
	s.workers.Wait()
}

// Results returns the latest results, keyed by proxy ID.
func (s *ProbeService) Results() map[string]ProbeResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]ProbeResult, len(s.results))
	for k, v := range s.results {
		out[k] = v
	}
	return out
}

type probeTarget struct {
	id, name, proxyType, endpoint, host, path string
}

// ProbeAll probes the online proxies of every running server once. Concurrent
// calls are coalesced, and Stop also cancels rounds started directly by callers.
func (s *ProbeService) ProbeAll(ctx context.Context) {
	s.mu.Lock()
	if s.ctx.Err() != nil || ctx.Err() != nil {
		s.mu.Unlock()
		return
	}
	s.workers.Add(1)
	s.mu.Unlock()
	defer s.workers.Done()

	select {
	case s.round <- struct{}{}:
		defer func() { <-s.round }()
	default:
		return
	}
	// Only a new round may use re-enabled proxies. An off/on toggle must not
	// revive a queued target or a late result from the previous settings.
	s.mu.Lock()
	clear(s.invalidated)
	s.mu.Unlock()
	ctx, cancel := context.WithCancel(ctx)
	stopCancel := context.AfterFunc(s.ctx, cancel)
	defer stopCancel()
	defer cancel()

	seen := map[string]bool{}
	var seenMu sync.Mutex
	var wg sync.WaitGroup
	jobs := make(chan *core.Record, serverPageSize)
	for range probeServerConcurrency {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for srv := range jobs {
				if ctx.Err() != nil {
					return
				}
				// Dashboard preparation belongs to the bounded worker, not the
				// serial listing path: one slow dashboard cannot block all peers.
				targets := s.targets(ctx, srv)
				seenMu.Lock()
				for _, target := range targets {
					seen[target.id] = true
				}
				seenMu.Unlock()
				s.probeServer(ctx, srv, targets)
			}
		}()
	}
	err := eachServer(ctx, s.app, func(srv *core.Record) {
		if srv.GetString("bootStatus") != "running" {
			return
		}
		select {
		case jobs <- srv:
		case <-ctx.Done():
		}
	})
	close(jobs)
	wg.Wait()
	if err != nil && ctx.Err() == nil {
		s.app.Logger().Warn("Proxy probe: failed to list servers", "error", err)
	}
	if ctx.Err() != nil || err != nil {
		return // An interrupted round must not discard previous results.
	}

	// Forget proxies that are no longer probed (offline, disabled, deleted, server stopped).
	s.mu.Lock()
	for id := range s.results {
		if !seen[id] {
			delete(s.results, id)
		}
	}
	s.mu.Unlock()
}

func (s *ProbeService) probeServer(ctx context.Context, srv *core.Record, targets []probeTarget) {
	results := make([]ProbeResult, len(targets))
	probeTargets(ctx, targets, func(ctx context.Context, i int, t probeTarget) {
		s.mu.Lock()
		if s.invalidated[t.id] || ctx.Err() != nil {
			s.mu.Unlock()
			return
		}
		probeCtx, cancel := context.WithCancel(ctx)
		s.active[t.id] = cancel
		s.mu.Unlock()

		err := s.runProbe(probeCtx, t)
		s.mu.Lock()
		defer s.mu.Unlock()
		defer cancel()
		delete(s.active, t.id)
		if s.invalidated[t.id] || probeCtx.Err() != nil {
			return // Opt-out/shutdown/caller cancellation is not an unreachable endpoint.
		}
		r := ProbeResult{ProxyID: t.id, Name: t.name, Endpoint: t.endpoint, Reachable: err == nil, Checked: time.Now()}
		if err != nil {
			r.Error = err.Error()
		}
		results[i] = r
		s.results[r.ProxyID] = r // Publish without waiting for the rest of the round.
	})
	// Alerts consume complete rounds, excluding targets disabled while this
	// batch was waiting. Serialize dispatch with hooks so old batches cannot
	// recreate an alert state just cleared by an opt-out (or off/on toggle).
	s.observeMu.Lock()
	defer s.observeMu.Unlock()
	if ctx.Err() == nil && s.observer != nil {
		s.mu.Lock()
		filtered := results[:0]
		for _, r := range results {
			if r.ProxyID != "" && !s.invalidated[r.ProxyID] {
				filtered = append(filtered, r)
			}
		}
		s.mu.Unlock()
		s.observer(srv.Id, srv.GetString("serverName"), filtered)
	}
}

func (s *ProbeService) runProbe(ctx context.Context, target probeTarget) error {
	select {
	case s.slots <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}
	defer func() { <-s.slots }()
	if err := ctx.Err(); err != nil {
		return err
	}
	return probe(ctx, target)
}

// probeTargets spreads starts over the target interval with bounded in-flight
// work. Pacing is needed even for TCP probes that return before frps has finished
// opening a work connection; a semaphore alone would still allow a burst.
func probeTargets(ctx context.Context, targets []probeTarget, run func(context.Context, int, probeTarget)) {
	if len(targets) == 0 {
		return
	}
	spacing := max(probeMinSpacing, ProbeInterval/time.Duration(len(targets)))
	slots := make(chan struct{}, probeConcurrency)
	var wg sync.WaitGroup
	defer wg.Wait()
	timer := time.NewTimer(0)
	defer timer.Stop()
	for i, t := range targets {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		select {
		case <-ctx.Done():
			return
		case slots <- struct{}{}:
		}
		if ctx.Err() != nil {
			<-slots
			return
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-slots }()
			run(ctx, i, t)
		}()
		// Reset after obtaining a slot, not against an absolute schedule:
		// slow probes cannot accumulate overdue launches that fire together.
		timer.Reset(spacing)
	}
}

// targets lists a server's probeable proxies that frpc reports online.
func (s *ProbeService) targets(ctx context.Context, srv *core.Record) []probeTarget {
	proxies, err := s.app.FindAllRecords("fh_proxies",
		dbx.HashExp{"serverId": srv.Id, "status": "enabled", "bootStatus": "online", "probeDisabled": false},
		dbx.In("proxyType", "tcp", "http", "https"),
	)
	if err != nil {
		return nil
	}

	// frps's vhost ports and subdomain host come from its dashboard, if configured.
	httpPort, httpsPort, subdomainHost := 80, 443, ""
	portsReady := true
	var cfg DashboardConfig
	_ = srv.UnmarshalJSONField("dashboard", &cfg)
	var stats *ServerStats
	if s.frps != nil {
		prepareCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
		stats, _ = s.frps.ReadyStats(prepareCtx, srv.Id)
		cancel()
	}
	if cfg.Configured() && (stats == nil || stats.Info == nil) {
		portsReady = false
	}
	if stats != nil && stats.Info != nil {
		if stats.Info.VhostHTTPPort > 0 {
			httpPort = stats.Info.VhostHTTPPort
		}
		if stats.Info.VhostHTTPSPort > 0 {
			httpsPort = stats.Info.VhostHTTPSPort
		}
		subdomainHost = stats.Info.SubdomainHost
	}

	var out []probeTarget
	addr := srv.GetString("serverAddr")
	for _, p := range proxies {
		t := probeTarget{id: p.Id, name: p.GetString("name"), proxyType: p.GetString("proxyType")}
		switch t.proxyType {
		case "tcp":
			port := p.GetInt("remotePort")
			if port <= 0 {
				continue // frps chose the port; Podux doesn't know it
			}
			t.endpoint = net.JoinHostPort(addr, strconv.Itoa(port))
		case "http", "https":
			if !portsReady {
				continue
			} // unknown configured ports are not 80/443
			t.host = probeHost(p.GetStringSlice("customDomains"), p.GetString("subdomain"), subdomainHost)
			if t.host == "" {
				continue
			}
			port := httpPort
			if t.proxyType == "https" {
				port = httpsPort
			}
			t.endpoint = net.JoinHostPort(t.host, strconv.Itoa(port))
			t.path = "/"
			var opts struct {
				Locations []string `json:"locations"`
			}
			_ = p.UnmarshalJSONField("options", &opts)
			if len(opts.Locations) > 0 && strings.HasPrefix(opts.Locations[0], "/") {
				t.path = opts.Locations[0]
			}
		}
		out = append(out, t)
	}
	return out
}

// probeHost picks the first concrete custom domain, else <subdomain>.<subdomainHost>.
func probeHost(customDomains []string, subdomain, subdomainHost string) string {
	for _, d := range customDomains {
		if d = strings.TrimSpace(d); d != "" && !strings.Contains(d, "*") {
			return d
		}
	}
	if subdomain != "" && subdomainHost != "" {
		return subdomain + "." + subdomainHost
	}
	return ""
}

func probe(ctx context.Context, t probeTarget) error {
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	dialer := &net.Dialer{}

	switch t.proxyType {
	case "tcp":
		conn, err := dialer.DialContext(ctx, "tcp", t.endpoint)
		if err != nil {
			return err
		}
		return conn.Close()

	case "https":
		conn, err := (&tls.Dialer{NetDialer: dialer, Config: &tls.Config{
			ServerName:         t.host,
			InsecureSkipVerify: true, // only checks that the tunnel answers; certificates are the service's business
		}}).DialContext(ctx, "tcp", t.endpoint)
		if err != nil {
			return err
		}
		return conn.Close()

	case "http":
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+t.endpoint+t.path, nil)
		if err != nil {
			return err
		}
		req.Host = t.host
		req.Header.Set("User-Agent", "Podux probe")
		client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		resp, err := client.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		switch {
		case resp.StatusCode == http.StatusNotFound && strings.Contains(string(body), frpsNotFoundMarker):
			return errors.New("frps has no route for this domain")
		case resp.StatusCode == http.StatusBadGateway, resp.StatusCode == http.StatusServiceUnavailable, resp.StatusCode == http.StatusGatewayTimeout:
			return fmt.Errorf("HTTP %d", resp.StatusCode)
		}
		return nil // any other answer, even 401 or 404 from the service, means the tunnel works
	}
	return fmt.Errorf("cannot probe %s proxies", t.proxyType)
}
