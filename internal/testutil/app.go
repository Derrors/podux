// Package testutil provides a migrated PocketBase app for tests.
package testutil

import (
	"testing"

	_ "podux/migrations"

	"github.com/pocketbase/pocketbase/core"
)

// NewApp returns a bootstrapped app with all migrations applied in a temp data dir.
func NewApp(t *testing.T) core.App {
	t.Helper()
	app := core.NewBaseApp(core.BaseAppConfig{DataDir: t.TempDir()})
	if err := app.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	if err := app.RunAllMigrations(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.ResetBootstrapState() })
	return app
}

// SaveRecord creates a record in collectionName with the given fields.
func SaveRecord(t *testing.T, app core.App, collectionName string, fields map[string]any) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(collection)
	r.Load(fields)
	if err := app.Save(r); err != nil {
		t.Fatalf("save %s: %v", collectionName, err)
	}
	return r
}
