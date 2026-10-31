package migrations_test

import (
	"testing"

	"podux/internal/testutil"
)

func TestAPIKeysCollectionRollback(t *testing.T) {
	app := testutil.NewApp(t)

	keys, err := app.FindCollectionByNameOrId("fh_api_keys")
	if err != nil {
		t.Fatal("fh_api_keys missing after migrations")
	}
	// Superusers only: keys are managed through /api/api-keys, never the collection API.
	if keys.ListRule != nil || keys.ViewRule != nil || keys.CreateRule != nil || keys.UpdateRule != nil || keys.DeleteRule != nil {
		t.Error("fh_api_keys must keep all API rules nil")
	}
	if f := keys.Fields.GetByName("keyHash"); f == nil || !f.GetHidden() {
		t.Error("fh_api_keys.keyHash must be hidden")
	}

	revertThrough(t, app, "1793792460_api_keys.go")
	if _, err := app.FindCollectionByNameOrId("fh_api_keys"); err == nil {
		t.Fatal("fh_api_keys still present after rollback")
	}
}
