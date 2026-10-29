package migrations_test

import (
	"testing"

	"podux/internal/testutil"
)

func TestRateLimitsEnabled(t *testing.T) {
	app := testutil.NewApp(t)

	limits := app.Settings().RateLimits
	if !limits.Enabled {
		t.Fatal("rate limiting is not enabled after migrations")
	}
	for _, rule := range limits.Rules {
		if rule.Label == "*:auth" && rule.MaxRequests > 0 {
			return
		}
	}
	t.Fatalf("no *:auth rule in %+v", limits.Rules)
}
