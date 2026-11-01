package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// Time-leading indexes bound aggregation/retention scans. Replace, rather than
// duplicate, the raw target index with equality columns before the time range.
func init() {
	m.Register(func(app core.App) error {
		for _, table := range []string{"fh_metrics_raw", "fh_metrics_hourly", "fh_metrics_daily"} {
			c, err := app.FindCollectionByNameOrId(table)
			if err != nil {
				return err
			}
			c.AddIndex("idx_"+table+"_time", false, "t", "")
			if table == "fh_metrics_raw" {
				c.RemoveIndex("idx_ccjpJ7y6sJ")
				c.AddIndex("idx_fh_metrics_raw_latest", false, "targetId, metricKey, t", "")
			}
			if err := app.Save(c); err != nil {
				return err
			}
		}
		c, err := app.FindCollectionByNameOrId("fh_metrics_targets")
		if err != nil {
			return err
		}
		c.Fields.Add(&core.DateField{Name: "latencySince"})
		if err := app.Save(c); err != nil {
			return err
		}
		state := core.NewBaseCollection("fh_metrics_state")
		state.Fields.Add(&core.TextField{Name: "kind", Required: true}, &core.DateField{Name: "watermark", Required: true})
		state.AddIndex("idx_fh_metrics_state_kind", true, "kind", "")
		// No API rules: only the internal scheduler may advance the watermark.
		return app.Save(state)
	}, func(app core.App) error {
		state, err := app.FindCollectionByNameOrId("fh_metrics_state")
		if err != nil {
			return err
		}
		if err := app.Delete(state); err != nil {
			return err
		}
		c, err := app.FindCollectionByNameOrId("fh_metrics_targets")
		if err != nil {
			return err
		}
		c.Fields.RemoveByName("latencySince")
		if err := app.Save(c); err != nil {
			return err
		}
		for _, table := range []string{"fh_metrics_raw", "fh_metrics_hourly", "fh_metrics_daily"} {
			c, err := app.FindCollectionByNameOrId(table)
			if err != nil {
				return err
			}
			c.RemoveIndex("idx_" + table + "_time")
			if table == "fh_metrics_raw" {
				c.RemoveIndex("idx_fh_metrics_raw_latest")
				c.AddIndex("idx_ccjpJ7y6sJ", false, "targetId, t, metricKey", "")
			}
			if err := app.Save(c); err != nil {
				return err
			}
		}
		return nil
	})
}
