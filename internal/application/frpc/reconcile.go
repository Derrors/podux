package frpc

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	v1 "github.com/fatedier/frp/pkg/config/v1"
	"podux/internal/frpconfig"
)

func commonHash(c *v1.ClientCommonConfig) [32]byte {
	b, _ := json.Marshal(c)
	return sha256.Sum256(b)
}

func (fs *Service) logConfigSummary(id, message string, proxies, visitors int) {
	// Keep the same structural redactor as export even for this deliberately small
	// allowlist. Names, addresses, metadata and config errors may contain credentials.
	summary, _ := frpconfig.Plain(map[string]any{"serverId": id, "proxyCount": proxies, "visitorCount": visitors}, false)
	fs.app.Logger().Info(message, "summary", summary)
}

// RegisterHooks owns runtime reconciliation for all configuration writes, including
// imports and relation moves. Call once from main and remove its old reload hooks.
// After-success hooks fire after commit; only enqueue work here, never wait for a
// lifecycle operation or write the database from a PocketBase save callback.
func (fs *Service) RegisterHooks() {
	fs.hooksOnce.Do(func() {
		fs.app.OnRecordCreateRequest("fh_servers", "fh_proxies").BindFunc(func(e *core.RecordRequestEvent) error {
			status := "offline"
			if e.Record.Collection().Name == "fh_servers" {
				status = "stopped"
			}
			e.Record.Set("bootStatus", status)
			return e.Next()
		})
		fs.app.OnRecordUpdateRequest("fh_servers", "fh_proxies").BindFunc(func(e *core.RecordRequestEvent) error {
			// Never write this field, even if the request's Original snapshot is older
			// than a lifecycle update. Only restoring Original without partial updates
			// would still overwrite a more recent status at SQL save time.
			e.Record.Set("bootStatus", e.Record.Original().Get("bootStatus"))
			e.Record.IgnoreUnchangedFields(true)
			return e.Next()
		})
		serverChanged := func(e *core.RecordEvent) error {
			if err := e.Next(); err != nil {
				return err
			}
			for _, key := range []string{"serverAddr", "serverPort", "user", "auth", "transport", "log", "metadatas"} {
				if e.Record.GetString(key) != e.Record.Original().GetString(key) {
					fs.RequestReload(e.Record.Id)
					break
				}
			}
			return nil
		}
		fs.app.OnRecordAfterUpdateSuccess("fh_servers").BindFunc(serverChanged)
		changed := func(e *core.RecordEvent) error {
			if err := e.Next(); err != nil {
				return err
			}
			fs.RequestReload(e.Record.GetString("serverId"))
			fs.RequestReload(e.Record.Original().GetString("serverId"))
			return nil
		}
		fs.app.OnRecordAfterCreateSuccess("fh_proxies", "fh_visitors").BindFunc(changed)
		fs.app.OnRecordAfterDeleteSuccess("fh_proxies", "fh_visitors").BindFunc(changed)
		fs.app.OnRecordAfterUpdateSuccess("fh_visitors").BindFunc(changed)
		fs.app.OnRecordAfterUpdateSuccess("fh_proxies").BindFunc(func(e *core.RecordEvent) error {
			if ProxyNeedsReload(e.Record) {
				return changed(e)
			}
			return e.Next()
		})
	})
}

// ReconcileServer hot-reloads proxies/visitors, or requests a full restart when
// common configuration changed. The lifecycle owns the restart and its status
// transitions; a simultaneous manual stop always wins over an automatic restart.
func (fs *Service) ReconcileServer(id string) error {
	fs.mu.Lock()
	inst := fs.instances[id]
	fs.mu.Unlock()
	if inst == nil {
		return nil
	}
	inst.reloadMu.Lock()
	defer inst.reloadMu.Unlock()
	fs.mu.Lock()
	if fs.instances[id] != inst || fs.closing || inst.stopRequested || inst.exiting || inst.svr == nil {
		fs.mu.Unlock()
		return nil
	}
	svr, common := inst.svr, inst.common
	fs.mu.Unlock()
	desired, err := fs.buildCommonCfg(&id)
	if err != nil {
		// Invalid edits cannot silently leave old credentials/transport running.
		fs.requestRestart(id, inst)
		return fmt.Errorf("saved common configuration requires correction before restart: %w", err)
	}
	if commonHash(desired) != inst.sourceHash {
		fs.requestRestart(id, inst)
		return nil
	}
	proxies, err := fs.genProxyCfgs(&id)
	if err != nil {
		return err
	}
	visitors, err := fs.genVisitorCfgs(&id)
	if err != nil {
		return err
	}
	if err := fs.writePluginCerts(id, proxies); err != nil {
		return err
	}
	files := pluginFiles(proxies)
	updateErr := svr.UpdateConfigSource(common, proxies, visitors)
	// frp's source replacement is non-atomic on error. Keep its latest candidate
	// plus the last applied generation, but don't accumulate every failed attempt.
	if err := fs.prunePluginCerts(id, files, inst.certFiles); err != nil {
		fs.app.Logger().Warn("Could not prune old plugin certificates", "serverId", id)
	}
	if updateErr != nil {
		return updateErr
	}
	inst.certFiles = files
	fs.logConfigSummary(id, "FRP configuration applied", len(proxies), len(visitors))
	return nil
}

func (fs *Service) requestRestart(id string, inst *instance) {
	fs.mu.Lock()
	if fs.instances[id] != inst || fs.closing || inst.stopRequested {
		fs.mu.Unlock()
		return
	}
	inst.restartRequested = true
	cancel := inst.cancel
	fs.mu.Unlock()
	fs.app.Logger().Info("Common configuration changed; restarting frpc", "serverId", id)
	if cancel != nil {
		cancel()
	}
}

// ResetRuntimeStatus belongs to the lifecycle, not to import or CRUD services.
// Call before AutoStartServers, while no instances are running.
func (fs *Service) ResetRuntimeStatus() error {
	if err := fs.serverRepo.ResetAllBootStatus(); err != nil {
		return err
	}
	return fs.proxyRepo.ResetAllBootStatus()
}
