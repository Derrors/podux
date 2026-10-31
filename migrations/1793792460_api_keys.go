package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// Add fh_api_keys: API keys for scripts and Prometheus, managed through /api/api-keys.
// Only a SHA-256 hash of each key is stored. All rules stay nil (superusers only),
// so the collection API never exposes them to Podux users. See application/apikey.
func init() {
	m.Register(func(app core.App) error {
		if _, err := app.FindCollectionByNameOrId("fh_api_keys"); err == nil {
			return nil
		}
		keys := core.NewBaseCollection("fh_api_keys")
		keys.Fields.Add(
			&core.TextField{Name: "name", Required: true, Max: 100},
			&core.TextField{Name: "keyHash", Required: true, Max: 64, Hidden: true},
			// prefix is the start of the key, shown so a key can be recognized.
			&core.TextField{Name: "prefix", Max: 32},
			&core.SelectField{Name: "scope", Required: true, MaxSelect: 1, Values: []string{"read", "write"}},
			&core.DateField{Name: "lastUsedAt"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		keys.AddIndex("idx_fh_api_keys_keyHash", true, "`keyHash`", "")
		return app.Save(keys)
	}, func(app core.App) error {
		keys, err := app.FindCollectionByNameOrId("fh_api_keys")
		if err != nil {
			return nil
		}
		return app.Delete(keys)
	})
}
