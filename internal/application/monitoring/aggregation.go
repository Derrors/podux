package monitoring

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// CatchUp commits each completed bucket and its watermark atomically. Startup,
// hourly ticks and retention all use the same recovery path; no current bucket is
// materialized. A failed bucket leaves its watermark unchanged for retry.
func (s *MetricsService) CatchUp(ctx context.Context) error {
	s.aggregateMu.Lock()
	defer s.aggregateMu.Unlock()
	return s.catchUp(ctx, time.Now().UTC())
}
func (s *MetricsService) catchUp(ctx context.Context, now time.Time) error {
	if err := s.aggregate(ctx, "hourly", now.Truncate(time.Hour)); err != nil {
		return err
	}
	return s.aggregate(ctx, "daily", now.Truncate(24*time.Hour))
}
func (s *MetricsService) AggregateHourly() error {
	s.aggregateMu.Lock()
	defer s.aggregateMu.Unlock()
	return s.aggregate(context.Background(), "hourly", time.Now().UTC().Truncate(time.Hour))
}
func (s *MetricsService) AggregateDaily() error { return s.CatchUp(context.Background()) }

func (s *MetricsService) aggregate(ctx context.Context, kind string, to time.Time) error {
	source, dest, step, avg, maxVal, minVal := "fh_metrics_raw", "fh_metrics_hourly", time.Hour, "AVG(val)", "MAX(val)", "MIN(val)"
	if kind == "daily" {
		source, dest, step, avg, maxVal, minVal = "fh_metrics_hourly", "fh_metrics_daily", 24*time.Hour, "AVG(valAvg)", "MAX(valMax)", "MIN(valMin)"
	}
	var watermark string
	err := s.app.DB().Select("watermark").From("fh_metrics_state").Where(dbx.HashExp{"kind": kind}).WithContext(ctx).Row(&watermark)
	initializing := errors.Is(err, sql.ErrNoRows)
	if err != nil && !initializing {
		return err
	}
	var from time.Time
	if !initializing {
		from, err = time.Parse(metricTimeFormat, watermark)
		if err != nil {
			return fmt.Errorf("invalid %s watermark: %w", kind, err)
		}
	}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if !from.IsZero() && !from.Before(to) {
			return nil
		}
		// MIN uses the time-leading index and skips empty hours/days in one seek.
		var first string
		err := s.app.DB().NewQuery(fmt.Sprintf(`SELECT COALESCE(MIN(t),'') FROM %s WHERE t >= {:from} AND t < {:to}`, source)).Bind(dbx.Params{"from": formatMetricTime(from), "to": to.Format(metricTimeFormat)}).WithContext(ctx).Row(&first)
		if err != nil {
			return err
		}
		next := to
		hasBucket := first != ""
		if hasBucket {
			at, err := time.Parse(metricTimeFormat, first)
			if err != nil {
				return err
			}
			from = at.Truncate(step)
			next = from.Add(step)
		}
		err = s.app.RunInTransaction(func(tx core.App) error {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if hasBucket {
				// Historical installs may have a complete aggregate for the oldest partly
				// retained source bucket. Preserve that row; still fill missing targets.
				conflict := "DO UPDATE SET valAvg=excluded.valAvg,valMax=excluded.valMax,valMin=excluded.valMin"
				if initializing {
					conflict = "DO NOTHING"
				}
				query := fmt.Sprintf(`INSERT INTO %s (id,targetId,metricKey,t,valAvg,valMax,valMin)
     SELECT lower(hex(randomblob(7))) || '0',targetId,metricKey,{:from},%s,%s,%s FROM %s
     WHERE t >= {:from} AND t < {:to} GROUP BY targetId,metricKey
     ON CONFLICT(targetId,metricKey,t) %s`, dest, avg, maxVal, minVal, source, conflict)
				if _, err := tx.DB().NewQuery(query).Bind(dbx.Params{"from": from.Format(metricTimeFormat), "to": next.Format(metricTimeFormat)}).WithContext(ctx).Execute(); err != nil {
					return err
				}
			}
			_, err := tx.DB().NewQuery(`INSERT INTO fh_metrics_state (id,kind,watermark) VALUES (lower(hex(randomblob(7))) || '0',{:kind},{:watermark}) ON CONFLICT(kind) DO UPDATE SET watermark=excluded.watermark`).Bind(dbx.Params{"kind": kind, "watermark": next.Format(metricTimeFormat)}).WithContext(ctx).Execute()
			return err
		})
		if err != nil {
			return fmt.Errorf("aggregate %s: %w", kind, err)
		}
		from = next
		initializing = false
	}
}
func formatMetricTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(metricTimeFormat)
}

// Retention does not discard a source until both rollups have caught up. Whole
// bucket boundaries prevent partial oldest buckets on the next recovery run.
func (s *MetricsService) PurgeOldRaw() error {
	return s.purgeAfterCatchUp(context.Background(), "fh_metrics_raw", time.Now().UTC().Add(-7*24*time.Hour).Truncate(time.Hour))
}
func (s *MetricsService) PurgeOldHourly() error {
	return s.purgeAfterCatchUp(context.Background(), "fh_metrics_hourly", time.Now().UTC().Add(-30*24*time.Hour).Truncate(24*time.Hour))
}
func (s *MetricsService) PurgeOldDaily() error {
	return s.purge(context.Background(), "fh_metrics_daily", time.Now().UTC().AddDate(-1, 0, 0).Truncate(24*time.Hour))
}
func (s *MetricsService) purgeAfterCatchUp(ctx context.Context, table string, cutoff time.Time) error {
	s.aggregateMu.Lock()
	defer s.aggregateMu.Unlock()
	if err := s.catchUp(ctx, time.Now().UTC()); err != nil {
		return err
	}
	return s.purge(ctx, table, cutoff)
}
func (s *MetricsService) Retain(ctx context.Context) error {
	s.aggregateMu.Lock()
	defer s.aggregateMu.Unlock()
	now := time.Now().UTC()
	if err := s.catchUp(ctx, now); err != nil {
		return err
	}
	for _, p := range []struct {
		table  string
		cutoff time.Time
	}{{"fh_metrics_raw", now.Add(-7 * 24 * time.Hour).Truncate(time.Hour)}, {"fh_metrics_hourly", now.Add(-30 * 24 * time.Hour).Truncate(24 * time.Hour)}, {"fh_metrics_daily", now.AddDate(-1, 0, 0).Truncate(24 * time.Hour)}} {
		if err := s.purge(ctx, p.table, p.cutoff); err != nil {
			return err
		}
	}
	return nil
}
func (s *MetricsService) purge(ctx context.Context, table string, cutoff time.Time) error {
	for {
		// Short bounded writer transactions let live sampling interleave with cleanup.
		query := fmt.Sprintf(`DELETE FROM %s WHERE id IN (SELECT id FROM %s WHERE t < {:cutoff} ORDER BY t LIMIT 2000)`, table, table)
		result, err := s.app.DB().NewQuery(query).Bind(dbx.Params{"cutoff": cutoff.Format(metricTimeFormat)}).WithContext(ctx).Execute()
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if n < 2000 {
			return nil
		}
	}
}
