package proxy

import (
	"time"

	proxydomain "podux/internal/domain/proxy"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// ExpiredFunc is told which proxies of a server were disabled because they expired.
type ExpiredFunc func(serverID, serverName string, proxyNames []string)

// RegisterExpiry checks every minute for enabled proxies whose expiresAt has passed
// and disables them (clearing expiresAt, so enabling one again keeps it on).
// Saving them fires the usual hooks, which reload the running frpc.
func RegisterExpiry(app core.App, onExpired ExpiredFunc) {
	run := func() {
		if _, err := DisableExpired(app, time.Now(), onExpired); err != nil {
			app.Logger().Error("Failed to disable expired proxies", "error", err)
		}
	}
	app.Cron().MustAdd("poduxProxyExpiry", "* * * * *", run)
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		go run() // catch proxies that expired while Podux was stopped
		return e.Next()
	})
}

// DisableExpired disables the enabled proxies that expired at or before now and
// returns how many it disabled.
func DisableExpired(app core.App, now time.Time, onExpired ExpiredFunc) (int, error) {
	records, err := app.FindAllRecords("fh_proxies",
		dbx.HashExp{"status": string(proxydomain.ProxyStatusEnabled)},
		dbx.NewExp("expiresAt != '' AND expiresAt <= {:now}", dbx.Params{"now": now.UTC().Format("2006-01-02 15:04:05.000Z")}),
	)
	if err != nil || len(records) == 0 {
		return 0, err
	}

	byServer := map[string][]string{}
	for _, r := range records {
		r.Set("status", string(proxydomain.ProxyStatusDisabled))
		r.Set("expiresAt", "")
		if err := app.Save(r); err != nil {
			app.Logger().Error("Failed to disable expired proxy", "proxyId", r.Id, "error", err)
			continue
		}
		app.Logger().Info("Disabled expired proxy", "proxyId", r.Id, "name", r.GetString("name"))
		byServer[r.GetString("serverId")] = append(byServer[r.GetString("serverId")], r.GetString("name"))
	}

	disabled := 0
	for serverID, names := range byServer {
		disabled += len(names)
		if onExpired == nil {
			continue
		}
		name := serverID
		if s, err := app.FindRecordById("fh_servers", serverID); err == nil {
			name = s.GetString("serverName")
		}
		onExpired(serverID, name, names)
	}
	return disabled, nil
}
