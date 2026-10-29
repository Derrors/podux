package monitoring

import (
	"fmt"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const MetricKeyFrpsDelay = "frps_delay"

// MetricsService handles writing latency data to fh_metrics_targets and fh_metrics_raw.
type MetricsService struct {
	app core.App

	// targetCache maps serverID -> fh_metrics_targets record ID
	targetCache     map[string]string
	targetCacheLock sync.RWMutex

	// latest holds the most recent probe result per server, including failures,
	// which are not written to fh_metrics_raw.
	latest     map[string]*NetworkStatus
	latestLock sync.RWMutex
	// forgotten holds deleted servers (guarded by latestLock): a probe that was already
	// running when the server was deleted must not bring it back into latest.
	forgotten map[string]struct{}
}

// latestFallbackWindow bounds the DB lookup used before a server has been probed
// since startup; older measurements are too stale to show.
const latestFallbackWindow = 10 * time.Minute

// NewMetricsService creates a new MetricsService.
func NewMetricsService(app core.App) *MetricsService {
	return &MetricsService{
		app:         app,
		targetCache: make(map[string]string),
		latest:      make(map[string]*NetworkStatus),
		forgotten:   make(map[string]struct{}),
	}
}

// RecordServerLatency records a probe result for a server.
// It automatically finds or creates the corresponding fh_metrics_targets record.
// Unreachable results (negative latency) only update the latest status, so they
// don't skew the stored latency series.
func (s *MetricsService) RecordServerLatency(serverID string, latencyMs int64, probeErr string) error {
	s.latestLock.Lock()
	if _, gone := s.forgotten[serverID]; gone {
		s.latestLock.Unlock()
		return nil
	}
	s.latest[serverID] = &NetworkStatus{
		Latency:       latencyMs,
		Reachable:     latencyMs >= 0,
		LastCheckTime: time.Now().UTC(),
		Error:         probeErr,
	}
	s.latestLock.Unlock()

	if latencyMs < 0 {
		return nil
	}

	targetID, err := s.getOrCreateServerTarget(serverID)
	if err != nil {
		return fmt.Errorf("get/create metrics target: %w", err)
	}

	return s.recordMetric(targetID, MetricKeyFrpsDelay, float64(latencyMs))
}

// getOrCreateServerTarget returns the fh_metrics_targets record ID for a server,
// creating one if it does not exist. Results are cached in memory.
func (s *MetricsService) getOrCreateServerTarget(serverID string) (string, error) {
	s.targetCacheLock.RLock()
	if id, ok := s.targetCache[serverID]; ok {
		s.targetCacheLock.RUnlock()
		return id, nil
	}
	s.targetCacheLock.RUnlock()

	// Acquire write lock for the entire find-or-create to prevent duplicate records
	// when multiple goroutines encounter a cache miss simultaneously.
	s.targetCacheLock.Lock()
	defer s.targetCacheLock.Unlock()

	// Re-check under write lock (another goroutine may have just created it).
	if id, ok := s.targetCache[serverID]; ok {
		return id, nil
	}

	records, err := s.app.FindRecordsByFilter(
		"fh_metrics_targets",
		"serverId = {:serverId} && proxyId = ''",
		"",
		1,
		0,
		map[string]any{"serverId": serverID},
	)
	if err != nil {
		return "", fmt.Errorf("query metrics target: %w", err)
	}

	var targetID string
	if len(records) > 0 {
		targetID = records[0].Id
	} else {
		collection, err := s.app.FindCollectionByNameOrId("fh_metrics_targets")
		if err != nil {
			return "", fmt.Errorf("find collection fh_metrics_targets: %w", err)
		}
		record := core.NewRecord(collection)
		record.Set("serverId", serverID)
		if err := s.app.Save(record); err != nil {
			return "", fmt.Errorf("save metrics target: %w", err)
		}
		targetID = record.Id
	}

	s.targetCache[serverID] = targetID
	return targetID, nil
}

// GetLatestLatencyBatch returns the most recent probe result for every server.
// The returned map key is the server ID. Servers not probed since startup fall back
// to their latest stored measurement from the last few minutes.
func (s *MetricsService) GetLatestLatencyBatch() (map[string]*NetworkStatus, error) {
	type row struct {
		ServerID string  `db:"serverId"`
		Val      float64 `db:"val"`
		T        string  `db:"t"`
	}

	since := time.Now().UTC().Add(-latestFallbackWindow).Format("2006-01-02 15:04:05.000Z")

	// SQLite returns the row holding MAX(r.t) for bare columns in the group.
	var rows []row
	err := s.app.DB().
		NewQuery(`
			SELECT t.serverId, r.val, MAX(r.t) AS t
			FROM fh_metrics_raw r
			INNER JOIN fh_metrics_targets t ON r.targetId = t.id
			WHERE r.metricKey = {:key}
			  AND r.t >= {:since}
			GROUP BY r.targetId
		`).
		Bind(dbx.Params{"key": MetricKeyFrpsDelay, "since": since}).
		All(&rows)
	if err != nil {
		return nil, err
	}

	result := make(map[string]*NetworkStatus, len(rows))
	for _, row := range rows {
		latency := int64(row.Val)
		t, _ := time.Parse("2006-01-02 15:04:05.000Z", row.T)
		result[row.ServerID] = &NetworkStatus{
			Latency:       latency,
			Reachable:     latency >= 0,
			LastCheckTime: t,
		}
	}

	s.latestLock.RLock()
	for serverID, status := range s.latest {
		copied := *status
		result[serverID] = &copied
	}
	s.latestLock.RUnlock()

	return result, nil
}

// MaxLatestLatency returns the highest latest latency among reachable servers,
// or 0 when none has been measured recently.
func (s *MetricsService) MaxLatestLatency() (int64, error) {
	latest, err := s.GetLatestLatencyBatch()
	if err != nil {
		return 0, err
	}
	var maxLatency int64
	for _, st := range latest {
		if st.Reachable && st.Latency > maxLatency {
			maxLatency = st.Latency
		}
	}
	return maxLatency, nil
}

// ForgetServer drops cached state for a deleted server and ignores its later probe results.
func (s *MetricsService) ForgetServer(serverID string) {
	s.targetCacheLock.Lock()
	delete(s.targetCache, serverID)
	s.targetCacheLock.Unlock()
	s.latestLock.Lock()
	delete(s.latest, serverID)
	s.forgotten[serverID] = struct{}{}
	s.latestLock.Unlock()
}

// AggregateHourly aggregates the previous full hour from fh_metrics_raw into fh_metrics_hourly.
// It is idempotent — re-running for the same hour updates existing records.
func (s *MetricsService) AggregateHourly() error {
	now := time.Now().UTC()
	to := now.Truncate(time.Hour)
	from := to.Add(-time.Hour)
	s.app.Logger().Info("Aggregating hourly metrics", "from", from, "to", to)

	type row struct {
		TargetID  string  `db:"targetId"`
		MetricKey string  `db:"metricKey"`
		ValAvg    float64 `db:"valAvg"`
		ValMax    float64 `db:"valMax"`
		ValMin    float64 `db:"valMin"`
	}

	var rows []row
	err := s.app.DB().
		NewQuery(`
			SELECT targetId, metricKey,
			       AVG(val) AS valAvg, MAX(val) AS valMax, MIN(val) AS valMin
			FROM fh_metrics_raw
			WHERE t >= {:from} AND t < {:to}
			GROUP BY targetId, metricKey
		`).
		Bind(dbx.Params{
			"from": from.Format("2006-01-02 15:04:05.000Z"),
			"to":   to.Format("2006-01-02 15:04:05.000Z"),
		}).
		All(&rows)
	if err != nil {
		return fmt.Errorf("query raw for hourly agg: %w", err)
	}

	tStr := from.Format("2006-01-02 15:04:05.000Z")
	for _, r := range rows {
		if err := s.upsertHourly(r.TargetID, r.MetricKey, tStr, r.ValAvg, r.ValMax, r.ValMin); err != nil {
			return err
		}
	}
	return nil
}

func (s *MetricsService) upsertHourly(targetID, metricKey, t string, avg, max, min float64) error {
	existing, err := s.app.FindRecordsByFilter(
		"fh_metrics_hourly",
		"targetId = {:targetId} && metricKey = {:metricKey} && t = {:t}",
		"", 1, 0,
		map[string]any{"targetId": targetID, "metricKey": metricKey, "t": t},
	)
	if err != nil {
		return fmt.Errorf("query hourly record: %w", err)
	}

	var record *core.Record
	if len(existing) > 0 {
		record = existing[0]
	} else {
		col, err := s.app.FindCollectionByNameOrId("fh_metrics_hourly")
		if err != nil {
			return fmt.Errorf("find collection fh_metrics_hourly: %w", err)
		}
		record = core.NewRecord(col)
		record.Set("targetId", targetID)
		record.Set("metricKey", metricKey)
		record.Set("t", t)
	}
	record.Set("valAvg", avg)
	record.Set("valMax", max)
	record.Set("valMin", min)
	if err := s.app.Save(record); err != nil {
		return fmt.Errorf("save hourly record: %w", err)
	}
	return nil
}

// AggregateDaily aggregates yesterday's hourly data into fh_metrics_daily.
// Only valAvg is stored since valMax/valMin in fh_metrics_daily are date-type fields.
func (s *MetricsService) AggregateDaily() error {
	now := time.Now().UTC()
	to := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	from := to.AddDate(0, 0, -1)
	s.app.Logger().Info("Aggregating daily metrics", "from", from, "to", to)

	type row struct {
		TargetID  string  `db:"targetId"`
		MetricKey string  `db:"metricKey"`
		ValAvg    float64 `db:"valAvg"`
	}

	var rows []row
	err := s.app.DB().
		NewQuery(`
			SELECT targetId, metricKey, AVG(valAvg) AS valAvg
			FROM fh_metrics_hourly
			WHERE t >= {:from} AND t < {:to}
			GROUP BY targetId, metricKey
		`).
		Bind(dbx.Params{
			"from": from.Format("2006-01-02 15:04:05.000Z"),
			"to":   to.Format("2006-01-02 15:04:05.000Z"),
		}).
		All(&rows)
	if err != nil {
		return fmt.Errorf("query hourly for daily agg: %w", err)
	}

	tStr := from.Format("2006-01-02 15:04:05.000Z")
	for _, r := range rows {
		if err := s.upsertDaily(r.TargetID, r.MetricKey, tStr, r.ValAvg); err != nil {
			return err
		}
	}
	return nil
}

func (s *MetricsService) upsertDaily(targetID, metricKey, t string, avg float64) error {
	existing, err := s.app.FindRecordsByFilter(
		"fh_metrics_daily",
		"targetId = {:targetId} && metricKey = {:metricKey} && t = {:t}",
		"", 1, 0,
		map[string]any{"targetId": targetID, "metricKey": metricKey, "t": t},
	)
	if err != nil {
		return fmt.Errorf("query daily record: %w", err)
	}

	var record *core.Record
	if len(existing) > 0 {
		record = existing[0]
	} else {
		col, err := s.app.FindCollectionByNameOrId("fh_metrics_daily")
		if err != nil {
			return fmt.Errorf("find collection fh_metrics_daily: %w", err)
		}
		record = core.NewRecord(col)
		record.Set("targetId", targetID)
		record.Set("metricKey", metricKey)
		record.Set("t", t)
	}
	record.Set("valAvg", avg)
	if err := s.app.Save(record); err != nil {
		return fmt.Errorf("save daily record: %w", err)
	}
	return nil
}

// PurgeOldRaw deletes fh_metrics_raw records older than 7 days.
func (s *MetricsService) PurgeOldRaw() error {
	cutoff := time.Now().UTC().Add(-7 * 24 * time.Hour).Format("2006-01-02 15:04:05.000Z")
	result, err := s.app.DB().
		Delete("fh_metrics_raw", dbx.NewExp("t < {:cutoff}", dbx.Params{"cutoff": cutoff})).
		Execute()
	if err != nil {
		return fmt.Errorf("purge old raw metrics: %w", err)
	}
	affected, _ := result.RowsAffected()
	s.app.Logger().Info("Purged old raw metrics", "deleted", affected)
	return nil
}

// PurgeOldHourly deletes fh_metrics_hourly records older than 30 days.
func (s *MetricsService) PurgeOldHourly() error {
	cutoff := time.Now().UTC().Add(-30 * 24 * time.Hour).Format("2006-01-02 15:04:05.000Z")
	result, err := s.app.DB().
		Delete("fh_metrics_hourly", dbx.NewExp("t < {:cutoff}", dbx.Params{"cutoff": cutoff})).
		Execute()
	if err != nil {
		return fmt.Errorf("purge old hourly metrics: %w", err)
	}
	affected, _ := result.RowsAffected()
	s.app.Logger().Info("Purged old hourly metrics", "deleted", affected)
	return nil
}

// PurgeOldDaily deletes fh_metrics_daily records older than 365 days.
func (s *MetricsService) PurgeOldDaily() error {
	cutoff := time.Now().UTC().AddDate(-1, 0, 0).Format("2006-01-02 15:04:05.000Z")
	result, err := s.app.DB().
		Delete("fh_metrics_daily", dbx.NewExp("t < {:cutoff}", dbx.Params{"cutoff": cutoff})).
		Execute()
	if err != nil {
		return fmt.Errorf("purge old daily metrics: %w", err)
	}
	affected, _ := result.RowsAffected()
	s.app.Logger().Info("Purged old daily metrics", "deleted", affected)
	return nil
}

// recordMetric writes a single data point to fh_metrics_raw.
func (s *MetricsService) recordMetric(targetID, metricKey string, value float64) error {
	collection, err := s.app.FindCollectionByNameOrId("fh_metrics_raw")
	if err != nil {
		return fmt.Errorf("find collection fh_metrics_raw: %w", err)
	}

	record := core.NewRecord(collection)
	record.Set("targetId", targetID)
	record.Set("metricKey", metricKey)
	record.Set("t", time.Now().UTC().Format("2006-01-02 15:04:05.000Z"))
	record.Set("val", value)

	if err := s.app.Save(record); err != nil {
		return fmt.Errorf("save metric record: %w", err)
	}

	return nil
}
