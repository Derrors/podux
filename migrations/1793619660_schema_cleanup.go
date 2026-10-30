package migrations

import (
	"fmt"
	"strconv"
	"strings"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
)

// portFields are the port columns the snapshot created as text.
var portFields = []struct {
	collection, field string
	required          bool
}{
	{"fh_servers", "serverPort", true},
	{"fh_proxies", "localPort", false},
	{"fh_proxies", "remotePort", false},
}

// Old non-unique indexes replaced by unique ones, and the unique ones.
const (
	oldHourlyIndex = "CREATE INDEX `idx_er76FRWKT4` ON `fh_metrics_hourly` (\n  `metricKey`,\n  `targetId`,\n  `t`\n)"
	oldDailyIndex  = "CREATE INDEX `idx_cytGPviJew` ON `fh_metrics_daily` (\n  `targetId`,\n  `metricKey`,\n  `t`\n)"
)

// Schema cleanup for items the database design listed as "to be confirmed":
//   - port fields become integer number fields (0 = not set) instead of text
//   - the unused fh_version collection is dropped
//   - duplicate metrics targets and hourly/daily rows are merged, and unique indexes
//     on (serverId, proxyId) and (targetId, metricKey, t) keep it that way
func init() {
	m.Register(func(app core.App) error {
		for _, p := range portFields {
			if err := retypePort(app, p.collection, p.field, p.required, true); err != nil {
				return err
			}
		}

		if c, err := app.FindCollectionByNameOrId("fh_version"); err == nil {
			if err := app.Delete(c); err != nil {
				return err
			}
		}

		if err := dedupeMetrics(app); err != nil {
			return err
		}
		if err := setIndexes(app, "fh_metrics_targets", "", "idx_fh_metrics_targets_unique", "`serverId`, `proxyId`"); err != nil {
			return err
		}
		if err := setIndexes(app, "fh_metrics_hourly", "idx_er76FRWKT4", "idx_fh_metrics_hourly_unique", "`targetId`, `metricKey`, `t`"); err != nil {
			return err
		}
		return setIndexes(app, "fh_metrics_daily", "idx_cytGPviJew", "idx_fh_metrics_daily_unique", "`targetId`, `metricKey`, `t`")
	}, func(app core.App) error {
		for _, name := range []string{"fh_metrics_targets", "fh_metrics_hourly", "fh_metrics_daily"} {
			c, err := app.FindCollectionByNameOrId(name)
			if err != nil {
				return err
			}
			c.RemoveIndex("idx_" + name + "_unique")
			switch name {
			case "fh_metrics_hourly":
				c.Indexes = append(c.Indexes, oldHourlyIndex)
			case "fh_metrics_daily":
				c.Indexes = append(c.Indexes, oldDailyIndex)
			}
			if err := app.Save(c); err != nil {
				return err
			}
		}

		if _, err := app.FindCollectionByNameOrId("fh_version"); err != nil {
			c := core.NewBaseCollection("fh_version")
			c.Fields.Add(
				&core.TextField{Name: "version_name"},
				&core.TextField{Name: "version_path"},
				&core.AutodateField{Name: "created", OnCreate: true},
				&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
			)
			if err := app.Save(c); err != nil {
				return err
			}
		}

		for _, p := range portFields {
			if err := retypePort(app, p.collection, p.field, p.required, false); err != nil {
				return err
			}
		}
		return nil
	})
}

// retypePort replaces a port field with a number field (toNumber) or back with a text
// field, keeping each record's value. PocketBase can't change a field's type in
// place, so the values are read, the field is swapped and the values written back.
func retypePort(app core.App, collection, field string, required, toNumber bool) error {
	c, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		return err
	}
	old := c.Fields.GetByName(field)
	if old == nil {
		return fmt.Errorf("%s.%s not found", collection, field)
	}
	if (old.Type() == core.FieldTypeNumber) == toNumber {
		return nil
	}

	var rows []struct {
		ID    string `db:"id"`
		Value string `db:"value"`
	}
	q := fmt.Sprintf("SELECT id, CAST(COALESCE([[%s]], '') AS TEXT) AS value FROM {{%s}}", field, collection)
	if err := app.DB().NewQuery(q).All(&rows); err != nil {
		return err
	}

	c.Fields.RemoveById(old.GetId())
	if toNumber {
		c.Fields.Add(&core.NumberField{Name: field, OnlyInt: true, Min: types.Pointer(0.0), Max: types.Pointer(65535.0), Required: required})
	} else {
		c.Fields.Add(&core.TextField{Name: field, Required: required})
	}
	if err := app.Save(c); err != nil {
		return err
	}

	for _, r := range rows {
		var value any
		if toNumber {
			n, _ := strconv.ParseFloat(strings.TrimSpace(r.Value), 64)
			value = int(n) // unparsable or empty text becomes 0, i.e. not set
		} else if n, _ := strconv.ParseFloat(r.Value, 64); n != 0 {
			value = strconv.Itoa(int(n))
		} else {
			value = ""
		}
		if _, err := app.DB().Update(collection, dbx.Params{field: value}, dbx.HashExp{"id": r.ID}).Execute(); err != nil {
			return err
		}
	}
	return nil
}

// dedupeMetrics merges metrics targets that share (serverId, proxyId) into the
// oldest one, then drops duplicate hourly/daily rows, keeping the newest write.
func dedupeMetrics(app core.App) error {
	stmts := []string{
		// Point data of duplicate targets at the kept (lowest rowid) target.
		`UPDATE {{%[1]s}} SET [[targetId]] = (
			SELECT k.id FROM {{fh_metrics_targets}} k
			JOIN {{fh_metrics_targets}} d ON k.serverId = d.serverId AND k.proxyId = d.proxyId
			WHERE d.id = {{%[1]s}}.targetId
			ORDER BY k.rowid LIMIT 1)
		WHERE [[targetId]] IN (SELECT id FROM {{fh_metrics_targets}})`,
	}
	for _, table := range []string{"fh_metrics_raw", "fh_metrics_hourly", "fh_metrics_daily"} {
		if _, err := app.DB().NewQuery(fmt.Sprintf(stmts[0], table)).Execute(); err != nil {
			return fmt.Errorf("repoint %s: %w", table, err)
		}
	}
	if _, err := app.DB().NewQuery(`DELETE FROM {{fh_metrics_targets}} WHERE rowid NOT IN (
		SELECT MIN(rowid) FROM {{fh_metrics_targets}} GROUP BY serverId, proxyId)`).Execute(); err != nil {
		return fmt.Errorf("dedupe targets: %w", err)
	}
	for _, table := range []string{"fh_metrics_hourly", "fh_metrics_daily"} {
		q := fmt.Sprintf(`DELETE FROM {{%[1]s}} WHERE rowid NOT IN (
			SELECT MAX(rowid) FROM {{%[1]s}} GROUP BY targetId, metricKey, t)`, table)
		if _, err := app.DB().NewQuery(q).Execute(); err != nil {
			return fmt.Errorf("dedupe %s: %w", table, err)
		}
	}
	return nil
}

// setIndexes removes the index named oldName (if any) and adds a unique index on columns.
func setIndexes(app core.App, collection, oldName, newName, columns string) error {
	c, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		return err
	}
	if oldName != "" {
		c.RemoveIndex(oldName)
	}
	c.RemoveIndex(newName)
	c.AddIndex(newName, true, columns, "")
	return app.Save(c)
}
