package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// An opt-out keeps public probes enabled for existing records and API/import
// callers that omit the field. It never changes frpc's proxy or healthCheck.
func init() {
	m.Register(func(app core.App) error {
		proxies, err := app.FindCollectionByNameOrId("fh_proxies")
		if err != nil {
			return err
		}
		if proxies.Fields.GetByName("probeDisabled") == nil {
			proxies.Fields.Add(&core.BoolField{Name: "probeDisabled"})
		}
		return app.Save(proxies)
	}, func(app core.App) error {
		proxies, err := app.FindCollectionByNameOrId("fh_proxies")
		if err != nil {
			return err
		}
		proxies.Fields.RemoveByName("probeDisabled")
		return app.Save(proxies)
	})
}
