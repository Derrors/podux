package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	m "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// probePublicHTTPS makes Podux probe a server's http/https proxies through their
// public HTTPS entry (domain:443, e.g. a reverse proxy in front of frps) instead of
// frps's vhost ports. It defaults to false, so existing servers keep probing the
// vhost ports. It is a Podux setting only and never reaches frpc.
func init() {
	m.Register(func(app core.App) error {
		servers, err := app.FindCollectionByNameOrId("fh_servers")
		if err != nil {
			return err
		}
		if servers.Fields.GetByName("probePublicHTTPS") == nil {
			servers.Fields.Add(&core.BoolField{Name: "probePublicHTTPS"})
		}
		return app.Save(servers)
	}, func(app core.App) error {
		servers, err := app.FindCollectionByNameOrId("fh_servers")
		if err != nil {
			return err
		}
		servers.Fields.RemoveByName("probePublicHTTPS")
		return app.Save(servers)
	})
}
