package migrations

import (
	"slices"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// secretProxyTypes are the proxy types reached through a visitor instead of a public port.
var secretProxyTypes = []string{"stcp", "sudp", "xtcp"}

const authRule = "@request.auth.id != ''"

// Support stcp/sudp/xtcp proxies and their visitors, plus proxy health checks:
//   - fh_proxies.proxyType gains stcp, sudp and xtcp
//   - fh_proxies gains secretKey, allowUsers (stcp/sudp/xtcp) and healthCheck
//   - new fh_visitors collection, one row per visitor, bound to a server like proxies
func init() {
	m.Register(func(app core.App) error {
		proxies, err := app.FindCollectionByNameOrId("fh_proxies")
		if err != nil {
			return err
		}
		if f, ok := proxies.Fields.GetByName("proxyType").(*core.SelectField); ok {
			for _, v := range secretProxyTypes {
				if !slices.Contains(f.Values, v) {
					f.Values = append(f.Values, v)
				}
			}
		}
		if proxies.Fields.GetByName("secretKey") == nil {
			proxies.Fields.Add(&core.TextField{Name: "secretKey", Max: 255})
		}
		if proxies.Fields.GetByName("allowUsers") == nil {
			proxies.Fields.Add(&core.JSONField{Name: "allowUsers"})
		}
		if proxies.Fields.GetByName("healthCheck") == nil {
			proxies.Fields.Add(&core.JSONField{Name: "healthCheck"})
		}
		if err := app.Save(proxies); err != nil {
			return err
		}

		if _, err := app.FindCollectionByNameOrId("fh_visitors"); err == nil {
			return nil
		}
		servers, err := app.FindCollectionByNameOrId("fh_servers")
		if err != nil {
			return err
		}
		visitors := core.NewBaseCollection("fh_visitors")
		visitors.ListRule = types.Pointer(authRule)
		visitors.ViewRule = types.Pointer(authRule)
		visitors.CreateRule = types.Pointer(authRule)
		visitors.UpdateRule = types.Pointer(authRule)
		visitors.DeleteRule = types.Pointer(authRule)
		visitors.Fields.Add(
			&core.TextField{Name: "name", Required: true, Max: 255},
			&core.SelectField{Name: "visitorType", Required: true, MaxSelect: 1, Values: secretProxyTypes},
			// Deleting a server deletes its visitors in server.RegisterDeleteHooks, like proxies.
			&core.RelationField{Name: "serverId", Required: true, MaxSelect: 1, CollectionId: servers.Id},
			// serverName/serverUser name the proxy to visit, as registered on frps.
			&core.TextField{Name: "serverName", Required: true, Max: 255},
			&core.TextField{Name: "serverUser", Max: 255},
			&core.TextField{Name: "secretKey", Max: 255},
			&core.TextField{Name: "bindAddr", Max: 255},
			&core.NumberField{Name: "bindPort", OnlyInt: true},
			&core.BoolField{Name: "keepTunnelOpen"},
			&core.JSONField{Name: "transport"},
			&core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"enabled", "disabled"}},
			&core.TextField{Name: "description", Max: 1000},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		visitors.AddIndex("idx_fh_visitors_serverId", false, "`serverId`", "")
		return app.Save(visitors)
	}, func(app core.App) error {
		if visitors, err := app.FindCollectionByNameOrId("fh_visitors"); err == nil {
			if err := app.Delete(visitors); err != nil {
				return err
			}
		}
		proxies, err := app.FindCollectionByNameOrId("fh_proxies")
		if err != nil {
			return err
		}
		if f, ok := proxies.Fields.GetByName("proxyType").(*core.SelectField); ok {
			f.Values = slices.DeleteFunc(f.Values, func(v string) bool { return slices.Contains(secretProxyTypes, v) })
		}
		proxies.Fields.RemoveByName("secretKey")
		proxies.Fields.RemoveByName("allowUsers")
		proxies.Fields.RemoveByName("healthCheck")
		return app.Save(proxies)
	})
}
