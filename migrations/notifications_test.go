package migrations_test

import (
	"testing"

	"podux/internal/testutil"
)

func TestNotificationsFieldRollback(t *testing.T) {
	app := testutil.NewApp(t)

	settings, err := app.FindCollectionByNameOrId("fh_settings")
	if err != nil {
		t.Fatal(err)
	}
	if settings.Fields.GetByName("notifications") == nil {
		t.Fatal("fh_settings.notifications missing after migrations")
	}

	revertThrough(t, app, "1793533260_notifications.go")
	settings, err = app.FindCollectionByNameOrId("fh_settings")
	if err != nil {
		t.Fatal(err)
	}
	if settings.Fields.GetByName("notifications") != nil {
		t.Fatal("notifications field still present after rollback")
	}
}
