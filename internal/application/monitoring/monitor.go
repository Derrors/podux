package monitoring

import (
	"context"
	"encoding/json"
	"net"
	"podux/pkg/utils"
	"strconv"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

const serverPageSize = 128
const latencyConcurrency = 16

// eachServer uses keyset pagination: concurrent updates/deletes cannot shift an
// offset and silently skip servers. Only one page of full records is retained.
func eachServer(ctx context.Context, app core.App, visit func(*core.Record)) error {
	after := ""
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		var records []*core.Record
		err := app.RecordQuery("fh_servers").WithContext(ctx).Where(dbx.NewExp("id > {:after}", dbx.Params{"after": after})).OrderBy("id").Limit(serverPageSize).All(&records)
		if err != nil {
			return err
		}
		for _, r := range records {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			visit(r)
			after = r.Id
		}
		if len(records) < serverPageSize {
			return nil
		}
	}
}

// MonitorService owns two non-overlapping loops and bounded worker pools.
type MonitorService struct {
	app            core.App
	geoService     *GeoService
	metricsService *MetricsService
	mu             sync.Mutex
	started        bool
	ctx            context.Context
	cancel         context.CancelFunc
	workers        sync.WaitGroup
	latencyTicker  *time.Ticker
	geoTicker      *time.Ticker
	geoQueue       chan geoRequest
	onLatency      LatencyObserver
	ping           func(context.Context, string, time.Duration) utils.PingResult
}
type geoRequest struct{ id, addr string }
type LatencyObserver func(serverID, serverName, addr string, running, reachable bool, latencyMs int64)

func (s *MonitorService) SetLatencyObserver(fn LatencyObserver) { s.onLatency = fn }
func NewMonitorService(app core.App, geoService *GeoService, metricsService *MetricsService) *MonitorService {
	ctx, cancel := context.WithCancel(context.Background())
	return &MonitorService{app: app, geoService: geoService, metricsService: metricsService, ctx: ctx, cancel: cancel, geoQueue: make(chan geoRequest, serverPageSize), ping: utils.PingHostContext}
}
func (s *MonitorService) Start(latencyInterval, geoInterval time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.started || s.ctx.Err() != nil {
		return
	}
	s.started = true
	s.latencyTicker = time.NewTicker(max(time.Second, latencyInterval))
	s.geoTicker = time.NewTicker(max(time.Second, geoInterval))
	s.startLoop(s.latencyTicker, s.updateAllServersLatency)
	s.startLoop(s.geoTicker, s.updateAllServersGeoLocation)
	s.workers.Add(1)
	go func() {
		defer s.workers.Done()
		for {
			select {
			case <-s.ctx.Done():
				return
			case req := <-s.geoQueue:
				s.updateServerGeoLocation(req.id, req.addr)
			}
		}
	}()
}
func (s *MonitorService) startLoop(ticker *time.Ticker, fn func()) {
	s.workers.Add(1)
	go func() {
		defer s.workers.Done()
		fn()
		for {
			select {
			case <-s.ctx.Done():
				return
			case <-ticker.C:
				fn()
			}
		}
	}()
}
func (s *MonitorService) UpdateIntervals(latencyInterval, geoInterval time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.latencyTicker == nil || s.ctx.Err() != nil {
		return
	}
	s.latencyTicker.Reset(max(time.Second, latencyInterval))
	s.geoTicker.Reset(max(time.Second, geoInterval))
}
func (s *MonitorService) Stop() {
	s.mu.Lock()
	s.cancel()
	if s.latencyTicker != nil {
		s.latencyTicker.Stop()
		s.geoTicker.Stop()
	}
	s.mu.Unlock()
	s.workers.Wait()
}

func (s *MonitorService) updateAllServersLatency() {
	jobs := make(chan *core.Record)
	samples := make(chan latencySample, latencyConcurrency)
	var wg sync.WaitGroup
	for range latencyConcurrency {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for record := range jobs {
				if s.ctx.Err() != nil {
					continue
				}
				sample := s.metricsService.beginLatency(record)
				result := s.ping(s.ctx, sample.endpoint, 5*time.Second)
				sample.latency, sample.err = result.Latency, result.Error
				sample.at = time.Now().UTC()
				select {
				case samples <- sample:
				case <-s.ctx.Done():
					return
				}
			}
		}()
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		batch := make([]latencySample, 0, 64)
		flush := func() {
			if len(batch) == 0 || s.ctx.Err() != nil {
				return
			}
			accepted, err := s.metricsService.recordLatencyBatch(s.ctx, batch)
			if err != nil {
				s.app.Logger().Warn("Record latency batch", "error", err)
			}
			if s.onLatency != nil {
				for _, sample := range accepted {
					s.onLatency(sample.id, sample.name, sample.endpoint, sample.running, sample.latency >= 0, sample.latency)
				}
			}
			batch = batch[:0]
		}
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case sample, ok := <-samples:
				if !ok {
					flush()
					return
				}
				batch = append(batch, sample)
				if len(batch) == cap(batch) {
					flush()
				}
			case <-ticker.C:
				flush()
			}
		}
	}()
	err := eachServer(s.ctx, s.app, func(r *core.Record) {
		select {
		case jobs <- r:
		case <-s.ctx.Done():
		}
	})
	close(jobs)
	wg.Wait()
	close(samples)
	<-done
	if err != nil && s.ctx.Err() == nil {
		s.app.Logger().Warn("List latency servers", "error", err)
	}
}
func (s *MonitorService) updateAllServersGeoLocation() {
	err := eachServer(s.ctx, s.app, func(r *core.Record) {
		if r.GetString("geoLocation") == "" || r.GetString("geoLocation") == "null" {
			s.updateServerGeoLocation(r.Id, r.GetString("serverAddr"))
		}
	})
	if err != nil && s.ctx.Err() == nil {
		s.app.Logger().Warn("List geolocation servers", "error", err)
	}
}

// RefreshGeoLocation coalesces work in a bounded queue, never spawning per-record
// goroutines. Overflow is recovered by the periodic missing-location scan.
func (s *MonitorService) RefreshGeoLocation(serverID, serverAddr string) {
	if s.ctx.Err() != nil {
		return
	}
	select {
	case s.geoQueue <- geoRequest{serverID, serverAddr}:
	default:
	}
}
func (s *MonitorService) updateServerGeoLocation(serverID, serverAddr string) {
	if s.ctx.Err() != nil {
		return
	}
	location, err := s.geoService.LookupContext(s.ctx, serverAddr)
	if err != nil {
		if s.ctx.Err() == nil {
			s.app.Logger().Debug("Geolocation lookup failed", "serverId", serverID, "error", err)
		}
		return
	}
	value, err := json.Marshal(location)
	if err != nil {
		return
	}
	_, err = s.app.DB().Update("fh_servers", dbx.Params{"geoLocation": string(value)}, dbx.HashExp{"id": serverID, "serverAddr": serverAddr}).WithContext(s.ctx).Execute()
	if err != nil && s.ctx.Err() == nil {
		s.app.Logger().Warn("Save geolocation", "error", err)
	}
}
func serverEndpoint(r *core.Record) string {
	return net.JoinHostPort(r.GetString("serverAddr"), strconv.Itoa(r.GetInt("serverPort")))
}
