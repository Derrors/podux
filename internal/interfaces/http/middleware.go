package httphandler

import (
	"net/http"
	"regexp"
	"strings"

	"podux/internal/application/apikey"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/hook"
)

var validID = regexp.MustCompile(`^[a-z0-9]{15}$`)

// apiKeyStoreKey is where APIKeyAuth leaves the request's API key for requireScope.
const apiKeyStoreKey = "podux.apiKey"

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

// requireScope is requireAuth that also accepts an API key allowed the scope.
// Only routes wrapped with it accept API keys.
func requireScope(scope string, next func(*core.RequestEvent) error) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if e.Auth != nil {
			return next(e)
		}
		key, _ := e.Get(apiKeyStoreKey).(*apikey.Key)
		if key == nil {
			return e.JSON(http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		}
		if !apikey.Allows(key.Scope, scope) {
			return e.JSON(http.StatusForbidden, map[string]string{"error": "this API key is read-only"})
		}
		return next(e)
	}
}

// APIKeyAuth resolves an "Authorization: Bearer pdx_..." API key for requireScope.
// It leaves e.Auth unset, so a key never acts as a user: not on the PocketBase
// collection API and not on routes guarded by requireAuth.
func APIKeyAuth(keys *apikey.Service) *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Id:       "poduxAPIKeyAuth",
		Priority: apis.DefaultLoadAuthTokenMiddlewarePriority + 1,
		Func: func(e *core.RequestEvent) error {
			if e.Auth != nil {
				return e.Next()
			}
			token := e.Request.Header.Get("Authorization")
			if len(token) > 7 && strings.EqualFold(token[:7], "Bearer ") {
				token = token[7:]
			}
			if !apikey.IsKey(token) {
				return e.Next()
			}
			key, err := keys.Authenticate(token)
			if err != nil {
				e.App.Logger().Warn("API key lookup failed", "error", err)
			} else if key != nil {
				e.Set(apiKeyStoreKey, key)
			}
			return e.Next()
		},
	}
}
