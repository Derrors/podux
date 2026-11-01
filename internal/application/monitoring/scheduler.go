package monitoring

import (
	"context"
	"sync"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// MetricsScheduler owns one cancellable worker; cron callbacks only coalesce
// work. Recovery also runs once at startup, including after downtime across hours.
type MetricsScheduler struct {
	app       core.App
	metrics   *MetricsService
	mu        sync.Mutex
	started   bool
	ctx       context.Context
	cancel    context.CancelFunc
	workers   sync.WaitGroup
	hourly    chan struct{}
	retention chan struct{}
}

func NewMetricsScheduler(app core.App, metrics *MetricsService) *MetricsScheduler {
	ctx, cancel := context.WithCancel(context.Background())
	return &MetricsScheduler{app: app, metrics: metrics, ctx: ctx, cancel: cancel, hourly: make(chan struct{}, 1), retention: make(chan struct{}, 1)}
}
func (s *MetricsScheduler) Register() {
	s.app.Cron().MustAdd("metrics_hourly_agg", "5 * * * *", func() {
		select {
		case s.hourly <- struct{}{}:
		default:
		}
	})
	s.app.Cron().MustAdd("metrics_daily_agg", "5 1 * * *", func() {
		select {
		case s.retention <- struct{}{}:
		default:
		}
	})
	s.Start()
}
func (s *MetricsScheduler) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.started || s.ctx.Err() != nil {
		return
	}
	s.started = true
	s.workers.Add(1)
	go func() {
		defer s.workers.Done()
		run := func(retain bool) {
			var err error
			if retain {
				err = s.metrics.Retain(s.ctx)
			} else {
				err = s.metrics.CatchUp(s.ctx)
			}
			if err != nil && s.ctx.Err() == nil {
				s.app.Logger().Error("Metrics recovery failed", "error", err)
			}
		}
		run(false)
		for {
			select {
			case <-s.ctx.Done():
				return
			case <-s.hourly:
				run(false)
			case <-s.retention:
				run(true)
			}
		}
	}()
}
func (s *MetricsScheduler) Stop() { s.mu.Lock(); s.cancel(); s.mu.Unlock(); s.workers.Wait() }
