package server

import (
	"fmt"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// RegisterDeleteHooks makes deleting an fh_servers record also delete its proxies,
// visitors and metrics in the same transaction (the relations don't cascade, and the
// required fh_proxies.serverId would otherwise block the delete).
// onDeleted runs after the delete is committed, e.g. to stop the server's frpc.
func RegisterDeleteHooks(app core.App, onDeleted func(serverID string)) {
	app.OnRecordDelete("fh_servers").BindFunc(func(e *core.RecordEvent) error {
		return e.App.RunInTransaction(func(txApp core.App) error {
			e.App = txApp
			if err := deleteDependents(txApp, e.Record.Id); err != nil {
				return err
			}
			return e.Next()
		})
	})

	app.OnRecordAfterDeleteSuccess("fh_servers").BindFunc(func(e *core.RecordEvent) error {
		if onDeleted != nil {
			onDeleted(e.Record.Id)
		}
		return e.Next()
	})
}

func deleteDependents(txApp core.App, serverID string) error {
	// Delete proxies and visitors as records so their hooks and realtime events still fire.
	for _, collection := range []string{"fh_proxies", "fh_visitors"} {
		records, err := txApp.FindAllRecords(collection, dbx.HashExp{"serverId": serverID})
		if err != nil {
			return fmt.Errorf("find %s: %w", collection, err)
		}
		for _, r := range records {
			if err := txApp.Delete(r); err != nil {
				return fmt.Errorf("delete %s %s: %w", collection, r.Id, err)
			}
		}
	}

	// Metrics can be large, so they are removed with plain SQL, children first.
	targets := dbx.NewExp(
		"targetId IN (SELECT id FROM fh_metrics_targets WHERE serverId = {:serverId})",
		dbx.Params{"serverId": serverID},
	)
	for _, table := range []string{"fh_metrics_raw", "fh_metrics_hourly", "fh_metrics_daily"} {
		if _, err := txApp.DB().Delete(table, targets).Execute(); err != nil {
			return fmt.Errorf("delete %s: %w", table, err)
		}
	}
	if _, err := txApp.DB().Delete("fh_metrics_targets", dbx.HashExp{"serverId": serverID}).Execute(); err != nil {
		return fmt.Errorf("delete metrics targets: %w", err)
	}
	return nil
}
