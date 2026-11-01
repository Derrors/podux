package proxy

import (
	"database/sql"
	"errors"
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
	for _, candidate := range records {
		var disabled *core.Record
		err := app.RunInTransaction(func(tx core.App) error {
			// The scan is only a list of candidates. Re-read after acquiring the
			// writer connection so renewal, deletion and target edits win if they
			// were committed since the scan; never save its stale user fields.
			r, err := tx.FindRecordById("fh_proxies", candidate.Id)
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			if err != nil {
				return err
			}
			expires := r.GetDateTime("expiresAt")
			if r.GetString("status") != string(proxydomain.ProxyStatusEnabled) || expires.IsZero() || expires.Time().After(now) {
				return nil
			}
			r.Set("status", string(proxydomain.ProxyStatusDisabled))
			r.Set("expiresAt", "")
			if err := tx.Save(r.IgnoreUnchangedFields(true)); err != nil {
				return err
			}
			disabled = r
			return nil
		})
		if err != nil {
			app.Logger().Error("Failed to disable expired proxy", "proxyId", candidate.Id, "error", err)
			continue
		}
		if disabled != nil {
			app.Logger().Info("Disabled expired proxy", "proxyId", disabled.Id, "name", disabled.GetString("name"))
			serverID := disabled.GetString("serverId")
			byServer[serverID] = append(byServer[serverID], disabled.GetString("name"))
		}
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
