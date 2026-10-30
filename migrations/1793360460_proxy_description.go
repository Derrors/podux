package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Add fh_proxies.description. The proxy form and domain model always sent it,
// but the collection had no such field, so PocketBase dropped it on save.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("fh_proxies")
		if err != nil {
			return err
		}
		if collection.Fields.GetByName("description") != nil {
			return nil
		}
		collection.Fields.Add(&core.TextField{
			Name: "description",
			Max:  1000,
		})
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("fh_proxies")
		if err != nil {
			return err
		}
		collection.Fields.RemoveByName("description")
		return app.Save(collection)
	})
}
