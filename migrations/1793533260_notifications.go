package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Add fh_settings.notifications: alert channels (webhook, Telegram, Bark, email),
// which events to send and the latency threshold. See application/notify.
func init() {
	m.Register(func(app core.App) error {
		settings, err := app.FindCollectionByNameOrId("fh_settings")
		if err != nil {
			return err
		}
		if settings.Fields.GetByName("notifications") != nil {
			return nil
		}
		settings.Fields.Add(&core.JSONField{Name: "notifications"})
		return app.Save(settings)
	}, func(app core.App) error {
		settings, err := app.FindCollectionByNameOrId("fh_settings")
		if err != nil {
			return err
		}
		settings.Fields.RemoveByName("notifications")
		return app.Save(settings)
	})
}
