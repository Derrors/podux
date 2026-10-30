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

// ProbeInterval is how often online proxies are probed from outside.
const ProbeInterval = time.Minute

const probeTimeout = 8 * time.Second

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
	stop     chan struct{}
	stopOnce sync.Once
}

func NewProbeService(app core.App, frps *FrpsService) *ProbeService {
	return &ProbeService{app: app, frps: frps, results: map[string]ProbeResult{}, stop: make(chan struct{})}
}

// SetObserver registers fn; call it before Start.
func (s *ProbeService) SetObserver(fn ProbeObserver) { s.observer = fn }

// Start probes every ProbeInterval until Stop.
func (s *ProbeService) Start() {
	go func() {
		ticker := time.NewTicker(ProbeInterval)
		defer ticker.Stop()
		for {
			select {
			case <-s.stop:
				return
			case <-ticker.C:
				s.ProbeAll(context.Background())
			}
		}
	}()
}

func (s *ProbeService) Stop() { s.stopOnce.Do(func() { close(s.stop) }) }

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

// ProbeAll probes the online proxies of every running server once.
func (s *ProbeService) ProbeAll(ctx context.Context) {
	servers, err := s.app.FindAllRecords("fh_servers", dbx.HashExp{"bootStatus": "running"})
	if err != nil {
		s.app.Logger().Warn("Proxy probe: failed to list servers", "error", err)
		return
	}
	seen := map[string]bool{}
	for _, srv := range servers {
		targets := s.targets(ctx, srv)
		results := make([]ProbeResult, len(targets))
		var wg sync.WaitGroup
		for i, t := range targets {
			seen[t.id] = true
			wg.Add(1)
			go func() {
				defer wg.Done()
				err := probe(ctx, t)
				results[i] = ProbeResult{ProxyID: t.id, Name: t.name, Endpoint: t.endpoint, Reachable: err == nil, Checked: time.Now()}
				if err != nil {
					results[i].Error = err.Error()
				}
			}()
		}
		wg.Wait()

		s.mu.Lock()
		for _, r := range results {
			s.results[r.ProxyID] = r
		}
		s.mu.Unlock()
		if s.observer != nil {
			s.observer(srv.Id, srv.GetString("serverName"), results)
		}
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

// targets lists a server's probeable proxies that frpc reports online.
func (s *ProbeService) targets(ctx context.Context, srv *core.Record) []probeTarget {
	proxies, err := s.app.FindAllRecords("fh_proxies",
		dbx.HashExp{"serverId": srv.Id, "status": "enabled", "bootStatus": "online"},
		dbx.In("proxyType", "tcp", "http", "https"),
	)
	if err != nil {
		return nil
	}

	// frps's vhost ports and subdomain host come from its dashboard, if configured.
	httpPort, httpsPort, subdomainHost := 80, 443, ""
	if stats, _ := s.frps.ServerStats(ctx, srv.Id); stats != nil && stats.Info != nil {
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
