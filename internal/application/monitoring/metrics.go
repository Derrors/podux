package monitoring

import (
	"context"
	"net"
	"strconv"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

const MetricKeyFrpsDelay = "frps_delay"
const metricTimeFormat = "2006-01-02 15:04:05.000Z"
const latestFallbackWindow = 10 * time.Minute

type MetricsService struct {
	app             core.App
	targetCache     map[string]string
	targetCacheLock sync.RWMutex
	latest          map[string]*NetworkStatus
	latestLock      sync.RWMutex
	forgotten       map[string]struct{}
	checked         map[string]bool
	endpoints       map[string]string
	generation      map[string]uint64
	fallbackMu      sync.Mutex
	aggregateMu     sync.Mutex
}

func NewMetricsService(app core.App) *MetricsService {
	return &MetricsService{app: app, targetCache: map[string]string{}, latest: map[string]*NetworkStatus{}, forgotten: map[string]struct{}{}, checked: map[string]bool{}, endpoints: map[string]string{}, generation: map[string]uint64{}}
}

// RegisterHooks prevents pre-edit measurements from being shown, including after
// restart: latencySince on the target is a persistent lower bound for fallback.
func (s *MetricsService) RegisterHooks() {
	s.app.OnRecordAfterUpdateSuccess("fh_servers").BindFunc(func(e *core.RecordEvent) error {
		if serverEndpoint(e.Record) != serverEndpoint(e.Record.Original()) {
			s.latestLock.Lock()
			s.generation[e.Record.Id]++
			delete(s.latest, e.Record.Id)
			s.checked[e.Record.Id] = true
			s.endpoints[e.Record.Id] = serverEndpoint(e.Record)
			s.latestLock.Unlock()
		}
		return e.Next()
	})
	// Persist the boundary in the same transaction as the server edit. This avoids
	// a crash between changing the endpoint and invalidating its historical data.
	s.app.OnRecordUpdate("fh_servers").BindFunc(func(e *core.RecordEvent) error {
		if serverEndpoint(e.Record) == serverEndpoint(e.Record.Original()) {
			return e.Next()
		}
		return e.App.RunInTransaction(func(tx core.App) error {
			originalApp := e.App
			e.App = tx
			defer func() { e.App = originalApp }()
			if err := e.Next(); err != nil {
				return err
			}
			_, err := tx.DB().Update("fh_metrics_targets", dbx.Params{"latencySince": time.Now().UTC().Format(metricTimeFormat)}, dbx.HashExp{"serverId": e.Record.Id, "proxyId": ""}).Execute()
			return err
		})
	})
	s.app.OnRecordAfterDeleteSuccess("fh_servers").BindFunc(func(e *core.RecordEvent) error { s.ForgetServer(e.Record.Id); return e.Next() })
}

type latencySample struct {
	id, name, endpoint, err string
	running                 bool
	latency                 int64
	at                      time.Time
	generation              uint64
}

func (s *MetricsService) beginLatency(r *core.Record) latencySample {
	s.latestLock.RLock()
	generation := s.generation[r.Id]
	s.latestLock.RUnlock()
	return latencySample{id: r.Id, name: r.GetString("serverName"), endpoint: serverEndpoint(r), running: r.GetString("bootStatus") == "running", generation: generation}
}
func (s *MetricsService) RecordServerLatency(serverID string, latencyMs int64, probeErr string) error {
	r, err := s.app.FindRecordById("fh_servers", serverID)
	if err != nil {
		return err
	}
	sample := s.beginLatency(r)
	sample.latency = latencyMs
	sample.err = probeErr
	sample.at = time.Now().UTC()
	_, err = s.recordLatencyBatch(context.Background(), []latencySample{sample})
	return err
}

// A whole batch uses one writer transaction. Inserts are internal, validated
// measurements, not API writes; avoiding Record.Save per sample removes relation
// validation queries and per-row transactions. Endpoint checks fence late probes.
func (s *MetricsService) recordLatencyBatch(ctx context.Context, samples []latencySample) ([]latencySample, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	accepted := make([]latencySample, 0, len(samples))
	err := s.app.RunInTransaction(func(tx core.App) error {
		for _, sample := range samples {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			s.latestLock.RLock()
			_, gone := s.forgotten[sample.id]
			valid := !gone && s.generation[sample.id] == sample.generation
			s.latestLock.RUnlock()
			if !valid {
				continue
			}
			r, err := tx.FindRecordById("fh_servers", sample.id)
			if err != nil || serverEndpoint(r) != sample.endpoint {
				continue
			}
			if sample.latency >= 0 {
				target, err := ensureServerTarget(tx, sample.id)
				if err != nil {
					return err
				}
				_, err = tx.DB().NewQuery(`INSERT INTO fh_metrics_raw (id,targetId,metricKey,t,val) VALUES (lower(hex(randomblob(7))) || '0',{:target},{:key},{:t},{:val})`).Bind(dbx.Params{"target": target, "key": MetricKeyFrpsDelay, "t": time.Now().UTC().Format(metricTimeFormat), "val": sample.latency}).WithContext(ctx).Execute()
				if err != nil {
					return err
				}
			}
			accepted = append(accepted, sample)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.latestLock.Lock()
	defer s.latestLock.Unlock()
	published := accepted[:0]
	for _, sample := range accepted {
		if _, gone := s.forgotten[sample.id]; gone || s.generation[sample.id] != sample.generation {
			continue
		}
		if previous := s.latest[sample.id]; previous != nil && previous.LastCheckTime.After(sample.at) {
			continue
		}
		s.latest[sample.id] = &NetworkStatus{Latency: sample.latency, Reachable: sample.latency >= 0, LastCheckTime: sample.at, Error: sample.err}
		s.checked[sample.id] = true
		s.endpoints[sample.id] = sample.endpoint
		published = append(published, sample)
	}
	return published, nil
}
func ensureServerTarget(app core.App, id string) (string, error) {
	_, err := app.DB().NewQuery(`INSERT INTO fh_metrics_targets (id,serverId,proxyId) VALUES (lower(hex(randomblob(7))) || '0',{:id},'') ON CONFLICT(serverId,proxyId) DO NOTHING`).Bind(dbx.Params{"id": id}).Execute()
	if err != nil {
		return "", err
	}
	var target string
	err = app.DB().Select("id").From("fh_metrics_targets").Where(dbx.HashExp{"serverId": id, "proxyId": ""}).Row(&target)
	return target, err
}
func (s *MetricsService) getOrCreateServerTarget(serverID string) (string, error) {
	s.targetCacheLock.Lock()
	defer s.targetCacheLock.Unlock()
	if id := s.targetCache[serverID]; id != "" {
		return id, nil
	}
	id, err := ensureServerTarget(s.app, serverID)
	if err == nil {
		s.targetCache[serverID] = id
	}
	return id, err
}

// GetLatestLatencyBatch reads memory first. Only never-checked live servers use
// indexed LIMIT 1 lookups; an empty result is negatively cached until a probe.
// Inventory is small and authoritative, so deletes/address changes are respected
// even without hooks. Stale memory never revives an older database measurement.
func (s *MetricsService) GetLatestLatencyBatch() (map[string]*NetworkStatus, error) {
	s.fallbackMu.Lock()
	defer s.fallbackMu.Unlock()
	var servers []struct {
		ID   string `db:"id"`
		Addr string `db:"serverAddr"`
		Port int    `db:"serverPort"`
	}
	if err := s.app.DB().Select("id", "serverAddr", "serverPort").From("fh_servers").All(&servers); err != nil {
		return nil, err
	}
	live := make(map[string]bool, len(servers))
	missing := []any{}
	generations := map[string]uint64{}
	s.latestLock.Lock()
	for _, server := range servers {
		live[server.ID] = true
		endpoint := net.JoinHostPort(server.Addr, strconv.Itoa(server.Port))
		if old, ok := s.endpoints[server.ID]; ok && old != endpoint {
			delete(s.latest, server.ID)
			s.checked[server.ID] = true
			s.generation[server.ID]++
		}
		s.endpoints[server.ID] = endpoint
		if !s.checked[server.ID] {
			if _, gone := s.forgotten[server.ID]; !gone {
				missing = append(missing, server.ID)
				generations[server.ID] = s.generation[server.ID]
			}
		}
	}
	for id := range s.latest {
		if !live[id] {
			delete(s.latest, id)
		}
	}
	s.latestLock.Unlock()
	since := time.Now().UTC().Add(-latestFallbackWindow)
	for len(missing) > 0 {
		n := min(128, len(missing))
		ids := missing[:n]
		missing = missing[n:]
		var rows []struct {
			ServerID string  `db:"serverId"`
			Val      float64 `db:"val"`
			T        string  `db:"t"`
		}
		// Correlated lookup performs a bounded descending index seek for each missing
		// server rather than GROUP BY scanning every server's recent raw samples.
		q := s.app.DB().Select("m.serverId", "r.val", "r.t").From("fh_metrics_targets m").InnerJoin("fh_metrics_raw r", dbx.NewExp(`r.id = (SELECT x.id FROM fh_metrics_raw x WHERE x.targetId=m.id AND x.metricKey={:key} AND x.t >= {:since} AND x.t >= COALESCE(m.latencySince,'') ORDER BY x.t DESC LIMIT 1)`, dbx.Params{"key": MetricKeyFrpsDelay, "since": since.Format(metricTimeFormat)})).Where(dbx.And(dbx.In("m.serverId", ids...), dbx.HashExp{"m.proxyId": ""}))
		if err := q.All(&rows); err != nil {
			return nil, err
		}
		s.latestLock.Lock()
		for _, id := range ids {
			s.checked[id.(string)] = true
		}
		for _, r := range rows {
			if _, gone := s.forgotten[r.ServerID]; gone {
				continue
			}
			// A live probe or hook always wins over this fallback query.
			if s.latest[r.ServerID] != nil || s.generation[r.ServerID] != generations[r.ServerID] {
				continue
			}
			at, err := time.Parse(metricTimeFormat, r.T)
			if err != nil {
				continue
			}
			s.latest[r.ServerID] = &NetworkStatus{Latency: int64(r.Val), Reachable: true, LastCheckTime: at}
		}
		s.latestLock.Unlock()
	}
	out := make(map[string]*NetworkStatus, len(servers))
	s.latestLock.RLock()
	defer s.latestLock.RUnlock()
	for id, status := range s.latest {
		if live[id] && !status.LastCheckTime.Before(since) {
			copy := *status
			out[id] = &copy
		}
	}
	return out, nil
}
func (s *MetricsService) MaxLatestLatency() (int64, error) {
	latest, err := s.GetLatestLatencyBatch()
	if err != nil {
		return 0, err
	}
	var maximum int64
	for _, status := range latest {
		if status.Reachable {
			maximum = max(maximum, status.Latency)
		}
	}
	return maximum, nil
}
func (s *MetricsService) ForgetServer(id string) {
	s.targetCacheLock.Lock()
	delete(s.targetCache, id)
	s.targetCacheLock.Unlock()
	s.latestLock.Lock()
	defer s.latestLock.Unlock()
	delete(s.latest, id)
	delete(s.endpoints, id)
	delete(s.checked, id)
	s.forgotten[id] = struct{}{}
	s.generation[id]++
}
