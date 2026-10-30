package httphandler

import (
	"net/http"
	"regexp"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

var validID = regexp.MustCompile(`^[a-z0-9]{15}$`)

// requireAuth wraps a handler with authentication check.
// Only the Authorization header is accepted; tokens in query strings would leak into access logs.
func requireAuth(next func(*core.RequestEvent) error) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if e.Auth == nil {
			return e.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		}
		return next(e)
	}
}
