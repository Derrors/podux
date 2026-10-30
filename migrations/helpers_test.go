package migrations_test

import (
	"slices"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// revertThrough rolls back app migrations one at a time, newest first, until
// the named migration has been reverted, so tests keep working as migrations are added.
func revertThrough(t *testing.T, app core.App, name string) {
	t.Helper()
	runner := core.NewMigrationsRunner(app, core.AppMigrations)
	for range 20 {
		reverted, err := runner.Down(1)
		if err != nil {
			t.Fatal(err)
		}
		if len(reverted) == 0 {
			break
		}
		if slices.Contains(reverted, name) {
			return
		}
	}
	t.Fatalf("migration %s was never reverted", name)
}
