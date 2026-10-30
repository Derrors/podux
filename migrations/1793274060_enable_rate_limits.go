package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// authRateLimit throttles password logins per client IP (PocketBase's default rule).
var authRateLimit = core.RateLimitRule{Label: "*:auth", MaxRequests: 2, Duration: 3}

// Enable PocketBase's built-in rate limiting, which is off by default, so login
// endpoints can't be brute-forced. Existing rules are kept; the auth rule is
// added if it is missing.
func init() {
	m.Register(func(app core.App) error {
		settings := app.Settings()
		settings.RateLimits.Enabled = true

		hasAuthRule := false
		for _, rule := range settings.RateLimits.Rules {
			if rule.Label == authRateLimit.Label {
				hasAuthRule = true
				break
			}
		}
		if !hasAuthRule {
			settings.RateLimits.Rules = append(settings.RateLimits.Rules, authRateLimit)
		}

		return app.Save(settings)
	}, func(app core.App) error {
		settings := app.Settings()
		settings.RateLimits.Enabled = false
		return app.Save(settings)
	})
}
