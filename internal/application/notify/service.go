// Package notify sends alerts when a server or its proxies go down, and when they recover.
//
// Alerts fire on sustained state, not single samples: a server must fail
// failThreshold latency probes in a row, and a proxy must be offline for
// failThreshold proxy status checks, so reloads and network blips stay quiet.
// Each alert is sent once and followed by one "recovered" message.
package notify

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"sync"
	"time"

	"podux/internal/application/system"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// failThreshold is how many consecutive bad observations raise an alert.
const failThreshold = 3

// ProxyCheckInterval is how often frpc reports proxy status (see frpc.monitorProxyStatus).
const ProxyCheckInterval = 5 * time.Second

const sendTimeout = 15 * time.Second

// ProxyState is one enabled proxy's status in a status check.
type ProxyState struct {
	ID     string
	Name   string
	Online bool
}

type proxyState struct {
	name    string
	offline int
	alerted bool
}

type serverState struct {
	unreachable        int
	unreachableAlerted bool
	slow               int
	slowAlerted        bool
	proxies            map[string]*proxyState
	// probes tracks external probes per proxy; name holds the probed endpoint.
	probes map[string]*proxyState
}

// ProbeState is one proxy's external probe result.
type ProbeState struct {
	ID        string
	Name      string
	Endpoint  string
	Reachable bool
}

type Service struct {
	app    core.App
	client *http.Client

	mu      sync.Mutex
	servers map[string]*serverState
	// send delivers a message; replaced in tests.
	send    func(Message)
	queueMu sync.Mutex
	queue   chan Message
	cancel  context.CancelFunc
	workers sync.WaitGroup
	stopped bool
}

func NewService(app core.App) *Service {
	s := &Service{
		app:     app,
		client:  &http.Client{Timeout: sendTimeout},
		servers: map[string]*serverState{},
	}
	s.send = s.dispatch
	return s
}

// GetSettings returns the saved settings, or the defaults if none were saved.
func (s *Service) GetSettings() (Settings, error) {
	record, err := s.app.FindRecordById("fh_settings", system.SettingsID)
	if err != nil {
		return DefaultSettings(), nil
	}
	return parseSettings(record.GetString("notifications"))
}

// SaveSettings validates and stores the settings.
func (s *Service) SaveSettings(settings Settings) error {
	if err := settings.Validate(); err != nil {
		return err
	}
	record, err := s.app.FindRecordById("fh_settings", system.SettingsID)
	if err != nil {
		return errors.New("system is not initialized")
	}
	record.Set("notifications", settings)
	return s.app.Save(record)
}

// SendTest sends a test message with the given (possibly unsaved) settings to each
// enabled channel and returns the error per channel; nil means delivered.
func (s *Service) SendTest(settings Settings) (map[string]error, error) {
	if err := settings.Validate(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), sendTimeout)
	defer cancel()
	return s.sendAll(ctx, settings, render(s.language(), EventTest, "", "")), nil
}

// ObserveLatency records a latency probe. Only running servers raise alerts; a
// stopped server's state is cleared so it starts fresh when started again.
func (s *Service) ObserveLatency(serverID, serverName, addr string, running, reachable bool, latencyMs int64) {
	settings, err := s.GetSettings()
	if err != nil || !settings.Enabled {
		return
	}

	var msgs []Message
	lang := s.language()
	s.mu.Lock()
	if !running {
		if st := s.servers[serverID]; st != nil {
			st.unreachable, st.unreachableAlerted, st.slow, st.slowAlerted = 0, false, 0, false
		}
		s.mu.Unlock()
		return
	}
	if _, err := s.app.FindRecordById("fh_servers", serverID); err != nil {
		s.mu.Unlock()
		return // deleted while the probe was running
	}
	st := s.state(serverID)
	if !reachable {
		st.unreachable++
		if st.unreachable >= failThreshold && !st.unreachableAlerted {
			st.unreachableAlerted = true
			if settings.Events.ServerUnreachable {
				msgs = append(msgs, render(lang, EventServerUnreachable, serverID, serverName, st.unreachable, addr))
			}
		}
	} else {
		if st.unreachableAlerted && settings.Events.Recovered {
			msgs = append(msgs, render(lang, EventServerRecovered, serverID, serverName, addr, latencyMs))
		}
		st.unreachable, st.unreachableAlerted = 0, false

		threshold := int64(settings.LatencyThresholdMs)
		if threshold > 0 && latencyMs > threshold {
			st.slow++
			if st.slow >= failThreshold && !st.slowAlerted {
				st.slowAlerted = true
				if settings.Events.HighLatency {
					msgs = append(msgs, render(lang, EventHighLatency, serverID, serverName, st.slow, threshold, latencyMs))
				}
			}
		} else {
			if st.slowAlerted && settings.Events.Recovered {
				msgs = append(msgs, render(lang, EventLatencyRecovered, serverID, serverName, latencyMs, threshold))
			}
			st.slow, st.slowAlerted = 0, false
		}
	}
	s.mu.Unlock()

	for _, m := range msgs {
		s.send(m)
	}
}

// ObserveProxies records one status check of a running server's enabled proxies.
// Proxies offline for failThreshold checks in a row are reported together.
func (s *Service) ObserveProxies(serverID, serverName string, states []ProxyState) {
	settings, err := s.GetSettings()
	if err != nil || !settings.Enabled {
		return
	}

	var down, back []string
	s.mu.Lock()
	st := s.state(serverID)
	seen := map[string]bool{}
	for _, p := range states {
		seen[p.ID] = true
		ps := st.proxies[p.ID]
		if ps == nil {
			ps = &proxyState{}
			st.proxies[p.ID] = ps
		}
		ps.name = p.Name
		if p.Online {
			if ps.alerted {
				back = append(back, p.Name)
			}
			ps.offline, ps.alerted = 0, false
			continue
		}
		ps.offline++
		if ps.offline >= failThreshold && !ps.alerted {
			ps.alerted = true
			down = append(down, p.Name)
		}
	}
	// Deleted or disabled proxies are dropped without a message.
	for id := range st.proxies {
		if !seen[id] {
			delete(st.proxies, id)
		}
	}
	s.mu.Unlock()

	lang := s.language()
	sort.Strings(down)
	sort.Strings(back)
	if len(down) > 0 && settings.Events.ProxyDown {
		seconds := int(ProxyCheckInterval/time.Second) * failThreshold
		s.send(render(lang, EventProxyDown, serverID, serverName, seconds, joinNames(down)))
	}
	if len(back) > 0 && settings.Events.Recovered {
		s.send(render(lang, EventProxyRecovered, serverID, serverName, joinNames(back)))
	}
}

// ObserveProbes records one round of external probes of a running server's proxies.
// Proxies failing failThreshold probes in a row are reported together.
func (s *Service) ObserveProbes(serverID, serverName string, results []ProbeState) {
	settings, err := s.GetSettings()
	if err != nil || !settings.Enabled {
		return
	}

	var down, back []string
	s.mu.Lock()
	st := s.state(serverID)
	seen := map[string]bool{}
	for _, r := range results {
		seen[r.ID] = true
		ps := st.probes[r.ID]
		if ps == nil {
			ps = &proxyState{}
			st.probes[r.ID] = ps
		}
		label := r.Name + " (" + r.Endpoint + ")"
		if r.Reachable {
			if ps.alerted {
				back = append(back, label)
			}
			ps.offline, ps.alerted = 0, false
			continue
		}
		ps.offline++
		if ps.offline >= failThreshold && !ps.alerted {
			ps.alerted = true
			down = append(down, label)
		}
	}
	// Proxies no longer probed (offline in frpc, disabled, deleted) are dropped quietly.
	for id := range st.probes {
		if !seen[id] {
			delete(st.probes, id)
		}
	}
	s.mu.Unlock()

	lang := s.language()
	sort.Strings(down)
	sort.Strings(back)
	if len(down) > 0 && settings.Events.ProxyUnreachable {
		s.send(render(lang, EventProxyUnreachable, serverID, serverName, failThreshold, joinNames(down)))
	}
	if len(back) > 0 && settings.Events.Recovered {
		s.send(render(lang, EventProxyReachable, serverID, serverName, joinNames(back)))
	}
}

// FrpcExited reports that a server's frpc stopped without the user asking.
func (s *Service) FrpcExited(serverID, serverName string, exitErr error) {
	s.ServerStopped(serverID)
	settings, err := s.GetSettings()
	if err != nil || !settings.Enabled || !settings.Events.FrpcExited {
		return
	}
	reason := "exited"
	if exitErr != nil {
		reason = exitErr.Error()
	}
	s.send(render(s.language(), EventFrpcExited, serverID, serverName, reason))
}

// ProxiesExpired reports temporary proxies that were disabled because they expired.
func (s *Service) ProxiesExpired(serverID, serverName string, names []string) {
	settings, err := s.GetSettings()
	if err != nil || !settings.Enabled || !settings.Events.ProxyExpired {
		return
	}
	sort.Strings(names)
	s.send(render(s.language(), EventProxyExpired, serverID, serverName, joinNames(names)))
}

// ServerStopped clears a server's proxy state, e.g. when the user stops it, so its
// proxies don't count as down and nothing is reported as recovered later.
func (s *Service) ServerStopped(serverID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if st := s.servers[serverID]; st != nil {
		st.proxies = map[string]*proxyState{}
		st.probes = map[string]*proxyState{}
	}
}

// ForgetProbe clears only a proxy's external-probe counters and alert state.
// Opting out is neither a failure nor a recovery; frpc's offline alerts remain.
func (s *Service) ForgetProbe(proxyID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, st := range s.servers {
		delete(st.probes, proxyID)
	}
}

// ForgetServer drops all state of a deleted server.
func (s *Service) ForgetServer(serverID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.servers, serverID)
}

func (s *Service) state(serverID string) *serverState {
	st := s.servers[serverID]
	if st == nil {
		st = &serverState{proxies: map[string]*proxyState{}, probes: map[string]*proxyState{}}
		s.servers[serverID] = st
	}
	return st
}

// language is the system default language chosen at setup ("zh" or "en").
func (s *Service) language() string {
	record, err := s.app.FindRecordById("fh_settings", system.SettingsID)
	if err != nil {
		return "en"
	}
	var general struct {
		DefaultLanguage string `json:"defaultLanguage"`
	}
	_ = json.Unmarshal([]byte(record.GetString("general")), &general)
	if general.DefaultLanguage == "zh" {
		return "zh"
	}
	return "en"
}

// dispatch never starts one goroutine per alert. The bounded queue is best
// effort: overload is explicitly logged instead of blocking tunnel/monitor work.
func (s *Service) dispatch(m Message) {
	s.queueMu.Lock()
	defer s.queueMu.Unlock()
	if s.stopped {
		return
	}
	if s.queue == nil {
		s.queue = make(chan Message, 256)
		ctx, cancel := context.WithCancel(context.Background())
		s.cancel = cancel
		for range 2 {
			s.workers.Add(1)
			go s.deliver(ctx)
		}
	}
	select {
	case s.queue <- m:
	default:
		s.app.Logger().Warn("Notification queue full; alert dropped", "event", m.Event, "serverId", m.ServerID)
	}
}

func (s *Service) deliver(ctx context.Context) {
	defer s.workers.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case m := <-s.queue:
			if ctx.Err() != nil {
				return
			}
			settings, err := s.GetSettings()
			if err != nil || !settings.Enabled {
				continue
			}
			sendCtx, cancel := context.WithTimeout(ctx, sendTimeout)
			results := s.sendAll(sendCtx, settings, m)
			cancel()
			if ctx.Err() != nil {
				return
			}
			for channel, err := range results {
				if err != nil {
					// Provider errors can echo credential-bearing webhook URLs.
					s.app.Logger().Warn("Failed to send notification", "channel", channel, "event", m.Event)
				} else {
					s.app.Logger().Info("Notification sent", "channel", channel, "event", m.Event, "serverId", m.ServerID)
				}
			}
		}
	}
}

// Stop cancels HTTP delivery and discards queued alerts. PocketBase's SMTP
// interface cannot be canceled; bound shutdown even if either mail worker hangs.
func (s *Service) Stop() {
	s.queueMu.Lock()
	s.stopped = true
	if s.cancel != nil {
		s.cancel()
	}
	s.queueMu.Unlock()
	done := make(chan struct{})
	go func() { s.workers.Wait(); close(done) }()
	timer := time.NewTimer(sendTimeout)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
		s.app.Logger().Warn("Notification shutdown timed out waiting for mail transport")
	}
}
