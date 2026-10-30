package migrations

import (
	"slices"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// Fields for the 0.2.5 proxy, visitor and server features:
//   - fh_proxies.proxyType gains tcpmux
//   - fh_proxies.options: extra frp proxy keys (httpUser, httpPassword, hostHeaderRewrite,
//     locations, requestHeaders, responseHeaders, routeByHTTPUser, multiplexer, loadBalancer)
//   - fh_proxies.expiresAt: temporary proxies are disabled once it passes
//   - fh_visitors.fallbackTo / fallbackTimeoutMs: an xtcp visitor falls back to another visitor
//   - fh_servers.dashboard: frps dashboard address and login, for traffic stats
func init() {
	m.Register(func(app core.App) error {
		proxies, err := app.FindCollectionByNameOrId("fh_proxies")
		if err != nil {
			return err
		}
		if f, ok := proxies.Fields.GetByName("proxyType").(*core.SelectField); ok && !slices.Contains(f.Values, "tcpmux") {
			f.Values = append(f.Values, "tcpmux")
		}
		if proxies.Fields.GetByName("options") == nil {
			proxies.Fields.Add(&core.JSONField{Name: "options"})
		}
		if proxies.Fields.GetByName("expiresAt") == nil {
			proxies.Fields.Add(&core.DateField{Name: "expiresAt"})
		}
		if err := app.Save(proxies); err != nil {
			return err
		}

		visitors, err := app.FindCollectionByNameOrId("fh_visitors")
		if err != nil {
			return err
		}
		if visitors.Fields.GetByName("fallbackTo") == nil {
			// ID of the fh_visitors record to fall back to.
			visitors.Fields.Add(&core.TextField{Name: "fallbackTo", Max: 15})
		}
		if visitors.Fields.GetByName("fallbackTimeoutMs") == nil {
			visitors.Fields.Add(&core.NumberField{Name: "fallbackTimeoutMs", OnlyInt: true})
		}
		if err := app.Save(visitors); err != nil {
			return err
		}

		servers, err := app.FindCollectionByNameOrId("fh_servers")
		if err != nil {
			return err
		}
		if servers.Fields.GetByName("dashboard") == nil {
			servers.Fields.Add(&core.JSONField{Name: "dashboard"})
		}
		return app.Save(servers)
	}, func(app core.App) error {
		proxies, err := app.FindCollectionByNameOrId("fh_proxies")
		if err != nil {
			return err
		}
		if f, ok := proxies.Fields.GetByName("proxyType").(*core.SelectField); ok {
			f.Values = slices.DeleteFunc(f.Values, func(v string) bool { return v == "tcpmux" })
		}
		proxies.Fields.RemoveByName("options")
		proxies.Fields.RemoveByName("expiresAt")
		if err := app.Save(proxies); err != nil {
			return err
		}

		visitors, err := app.FindCollectionByNameOrId("fh_visitors")
		if err != nil {
			return err
		}
		visitors.Fields.RemoveByName("fallbackTo")
		visitors.Fields.RemoveByName("fallbackTimeoutMs")
		if err := app.Save(visitors); err != nil {
			return err
		}

		servers, err := app.FindCollectionByNameOrId("fh_servers")
		if err != nil {
			return err
		}
		servers.Fields.RemoveByName("dashboard")
		return app.Save(servers)
	})
}
