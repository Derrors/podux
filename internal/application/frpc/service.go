package frpc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"podux/internal/application/notify"
	proxydomain "podux/internal/domain/proxy"
	serverdomain "podux/internal/domain/server"
	visitordomain "podux/internal/domain/visitor"
	"podux/internal/frpconfig"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"github.com/fatedier/frp/client"
	frpcsource "github.com/fatedier/frp/pkg/config/source"
	v1 "github.com/fatedier/frp/pkg/config/v1"
	"github.com/fatedier/frp/pkg/util/xlog"
)

var validServerID = regexp.MustCompile(`^[a-z0-9]{15}$`)

// ErrAlreadyRunning is returned when launching a server that is already running or starting.
var ErrAlreadyRunning = errors.New("frpc is already running for this server")

// ErrLaunchCancelled is returned by LaunchFrpc when the server was stopped (or deleted)
// while its frpc was still starting.
var ErrLaunchCancelled = errors.New("frpc launch was cancelled by a stop request")

// ErrLogNotFound is returned by StreamLog when no frpc log file exists yet.
var ErrLogNotFound = errors.New("no frpc log file yet")

// replayEndFrame marks the end of the replayed history in a log stream, so the
// client can merge it with lines it already shows.
const replayEndFrame = "event: replay-end\ndata:\n\n"

const stopTimeout = 10 * time.Second

// instance is one running frpc client. svr is nil while the instance is still starting.
type instance struct {
	svr      *client.Service
	common   *v1.ClientCommonConfig
	cancel   context.CancelFunc
	graceful bool
	stopped  chan struct{}
	// stopRequested is set by TerminateFrpc while the instance is still starting
	// (cancel is nil); LaunchFrpc then gives up instead of running frpc.
	stopRequested bool
	// reloadMu orders snapshots, config updates and final cleanup.
	reloadMu         sync.Mutex
	sourceHash       [32]byte
	certFiles        map[string]bool
	restartRequested bool
	exiting          bool
}

type Service struct {
	mu          sync.Mutex
	app         core.App
	instances   map[string]*instance
	serverRepo  serverdomain.Repository
	proxyRepo   proxydomain.Repository
	visitorRepo visitordomain.Repository
	logger      sharedLogger
	observer    StatusObserver
	// reloadTimers holds pending RequestReload calls per server (guarded by mu).
	reloadTimers map[string]*time.Timer
	ctx          context.Context
	cancel       context.CancelFunc
	closing      bool
	hooksOnce    sync.Once
}

// reloadDelay batches the reloads of quick successive changes, e.g. a batch edit.
const reloadDelay = 300 * time.Millisecond

// RequestReload reloads a running server's frpc after reloadDelay; further requests
// within that time are merged into the same reload.
func (fs *Service) RequestReload(serverID string) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	inst := fs.instances[serverID]
	if fs.closing || inst == nil || inst.stopRequested || inst.exiting {
		return
	}
	if t := fs.reloadTimers[serverID]; t != nil {
		t.Stop()
	}
	var timer *time.Timer
	timer = time.AfterFunc(reloadDelay, func() {
		fs.mu.Lock()
		if fs.reloadTimers[serverID] != timer || fs.instances[serverID] != inst {
			fs.mu.Unlock()
			return
		}
		delete(fs.reloadTimers, serverID)
		fs.mu.Unlock()
		if err := fs.ReconcileServer(serverID); err != nil {
			// Never log full configuration or potentially credential-bearing frp errors.
			fs.app.Logger().Error("Failed to apply frpc configuration; restart required", "serverId", serverID)
		}
	})
	fs.reloadTimers[serverID] = timer
}

// StatusObserver is told about proxy status checks and frpc stopping, e.g. to send alerts.
type StatusObserver interface {
	// ObserveProxies receives each status check of a running server's enabled proxies.
	ObserveProxies(serverID, serverName string, states []notify.ProxyState)
	// FrpcExited is called when frpc stops without the user asking.
	FrpcExited(serverID, serverName string, err error)
	// ServerStopped is called when the user stops a server.
	ServerStopped(serverID string)
}

// SetObserver registers o; call it before any server starts.
func (fs *Service) SetObserver(o StatusObserver) {
	fs.observer = o
}

func (fs *Service) serverName(id string) string {
	if r, err := fs.app.FindRecordById("fh_servers", id); err == nil {
		return r.GetString("serverName")
	}
	return id
}

func NewService(app core.App, serverRepo serverdomain.Repository, proxyRepo proxydomain.Repository, visitorRepo visitordomain.Repository) *Service {
	ctx, cancel := context.WithCancel(context.Background())
	return &Service{
		ctx: ctx, cancel: cancel,
		visitorRepo:  visitorRepo,
		app:          app,
		instances:    make(map[string]*instance),
		reloadTimers: make(map[string]*time.Timer),
		serverRepo:   serverRepo,
		proxyRepo:    proxyRepo,
	}
}

// unmarshalField decodes a JSON field, treating an empty value as "not set".
func unmarshalField(raw string, v any) error {
	if raw == "" || raw == "null" {
		return nil
	}
	return json.Unmarshal([]byte(raw), v)
}

// genCommonCfgs builds a server's common config for running it: logs go to the shared
// log file and TLS certificate contents are written to the server's certs directory.
func (fs *Service) genCommonCfgs(id *string) (*v1.ClientCommonConfig, error) {
	cfg, err := fs.buildCommonCfg(id)
	if err != nil {
		return nil, err
	}

	if err := fs.materializeCommon(*id, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

// buildCommonCfg maps a server record to frp's common config without touching the
// disk: log.to is left unset and TLS cert/key/CA fields hold the stored PEM contents.
func (fs *Service) buildCommonCfg(id *string) (*v1.ClientCommonConfig, error) {
	if !validServerID.MatchString(*id) {
		return nil, errors.New("invalid server id")
	}
	record, err := fs.app.FindRecordById("fh_servers", *id)
	if err != nil {
		return nil, err
	}
	return frpconfig.Common(record)
}

// proxyOptionKeys are the frp proxy keys fh_proxies.options may set, per proxy type.
// Keys for other types are ignored rather than sent to frp.
var proxyOptionKeys = map[string][]string{
	"tcp":    {"loadBalancer"},
	"http":   {"locations", "httpUser", "httpPassword", "hostHeaderRewrite", "requestHeaders", "responseHeaders", "routeByHTTPUser", "loadBalancer"},
	"tcpmux": {"httpUser", "httpPassword", "routeByHTTPUser", "multiplexer", "loadBalancer"},
}

var legacyTransportKeys = map[string]string{
	"use_encryption":  "useEncryption",
	"use_compression": "useCompression",
}

func (fs *Service) genProxyCfgs(serverId *string) ([]v1.ProxyConfigurer, error) {
	proxies, err := fs.proxyRepo.FindEnabledByServerID(*serverId)
	if err != nil {
		fs.app.Logger().Error("genProxyCfgs", "err", err)
		return nil, err
	}

	var proxyCfgs []v1.ProxyConfigurer
	for _, proxyMap := range proxies {
		jsonData, err := json.Marshal(proxyMap)
		if err != nil {
			return nil, err
		}

		// Convert to map to manipulate fields
		var proxyData map[string]interface{}
		if err := json.Unmarshal(jsonData, &proxyData); err != nil {
			return nil, err
		}

		options, _ := proxyData["options"].(map[string]interface{})
		delete(proxyData, "options")
		delete(proxyData, "probeDisabled") // Podux's public probe setting is not an frpc option.
		for _, key := range proxyOptionKeys[proxyMap.ProxyType] {
			if v, ok := options[key]; ok && !isEmptyOption(v) {
				proxyData[key] = v
			}
		}

		switch proxyMap.ProxyType {
		case "http", "https":
			delete(proxyData, "remotePort")
		case "tcpmux":
			delete(proxyData, "remotePort")
			if proxyData["multiplexer"] == nil {
				proxyData["multiplexer"] = string(v1.TCPMultiplexerHTTPConnect)
			}
		case "stcp", "sudp", "xtcp":
			// Reached through visitors, not a public port or domain.
			delete(proxyData, "remotePort")
			delete(proxyData, "subdomain")
			delete(proxyData, "customDomains")
		default:
			delete(proxyData, "secretKey")
			delete(proxyData, "allowUsers")
		}
		proxyData["type"] = proxyMap.ProxyType
		delete(proxyData, "proxyType")
		proxyData["name"] = proxyMap.Name + "-" + proxyMap.Id

		// Older proxy forms saved snake_case keys; frp only reads camelCase.
		if transport, ok := proxyData["transport"].(map[string]interface{}); ok {
			for legacy, key := range legacyTransportKeys {
				if v, ok := transport[legacy]; ok {
					if _, set := transport[key]; !set {
						transport[key] = v
					}
					delete(transport, legacy)
				}
			}
		}

		// Remove empty plugin map so frp doesn't try to parse a typeless plugin
		if plugin, ok := proxyData["plugin"].(map[string]interface{}); ok {
			if _, hasType := plugin["type"]; !hasType {
				delete(proxyData, "plugin")
			}
		}
		// A health check without a type is off; drop it rather than send its leftover fields.
		if hc, ok := proxyData["healthCheck"].(map[string]interface{}); ok {
			if t, _ := hc["type"].(string); t == "" {
				delete(proxyData, "healthCheck")
			}
		}

		jsonData, err = json.Marshal(proxyData)
		if err != nil {
			return nil, err
		}

		cfg := v1.NewProxyConfigurerByType(v1.ProxyType(proxyMap.ProxyType))
		if cfg == nil {
			fs.app.Logger().Warn("Skipping proxy of unsupported type", "proxyId", proxyMap.Id, "type", proxyMap.ProxyType)
			continue
		}
		if err := json.Unmarshal(jsonData, cfg); err != nil {
			return nil, fmt.Errorf("proxy %s: %w", proxyMap.Name, err)
		}
		if err := frpconfig.Proxy(cfg); err != nil {
			return nil, fmt.Errorf("invalid proxy %s configuration: %w", proxyMap.Id, err)
		}
		proxyCfgs = append(proxyCfgs, cfg)
	}

	return proxyCfgs, nil
}

// genVisitorCfgs builds the enabled visitors of a server. Like proxies, a visitor's
// runtime name is "<name>-<id>" so names stay unique per server.
func (fs *Service) genVisitorCfgs(serverId *string) ([]v1.VisitorConfigurer, error) {
	visitors, err := fs.visitorRepo.FindEnabledByServerID(*serverId)
	if err != nil {
		return nil, err
	}

	byID := make(map[string]visitordomain.Visitor, len(visitors))
	for _, v := range visitors {
		byID[v.Id] = v
	}

	var cfgs []v1.VisitorConfigurer
	for _, v := range visitors {
		data := map[string]any{
			"name":       v.Name + "-" + v.Id,
			"type":       v.VisitorType,
			"serverName": v.ServerName,
			"secretKey":  v.SecretKey,
			"bindAddr":   v.BindAddr,
			"bindPort":   v.BindPort,
		}
		if v.ServerUser != "" {
			data["serverUser"] = v.ServerUser
		}
		if data["bindAddr"] == "" {
			data["bindAddr"] = "127.0.0.1"
		}
		if len(v.Transport) > 0 {
			data["transport"] = map[string]any(v.Transport)
		}
		if v.VisitorType == "xtcp" {
			data["keepTunnelOpen"] = v.KeepTunnelOpen
			// Fall back to another visitor of this server (usually stcp) when p2p fails.
			if fb, ok := byID[v.FallbackTo]; ok && v.FallbackTo != v.Id {
				data["fallbackTo"] = fb.Name + "-" + fb.Id
				if v.FallbackTimeoutMs > 0 {
					data["fallbackTimeoutMs"] = v.FallbackTimeoutMs
				}
			} else if v.FallbackTo != "" {
				fs.app.Logger().Warn("Visitor fallback is not an enabled visitor of this server", "visitorId", v.Id, "fallbackTo", v.FallbackTo)
			}
		}
		jsonData, err := json.Marshal(data)
		if err != nil {
			return nil, err
		}

		cfg := v1.NewVisitorConfigurerByType(v1.VisitorType(v.VisitorType))
		if cfg == nil {
			fs.app.Logger().Warn("Skipping visitor of unsupported type", "visitorId", v.Id, "type", v.VisitorType)
			continue
		}
		if err := json.Unmarshal(jsonData, cfg); err != nil {
			return nil, fmt.Errorf("visitor %s: %w", v.Name, err)
		}
		if err := frpconfig.Visitor(cfg); err != nil {
			return nil, fmt.Errorf("invalid visitor %s configuration: %w", v.Id, err)
		}
		cfgs = append(cfgs, cfg)
	}
	return cfgs, nil
}

// LaunchFrpc starts frpc for a server. It returns ErrAlreadyRunning if the
// server is already running or another launch is in progress.
func (fs *Service) LaunchFrpc(serverId *string) error {
	if serverId == nil || !validServerID.MatchString(*serverId) {
		return errors.New("invalid server id")
	}
	id := *serverId
	inst := &instance{stopped: make(chan struct{})}
	fs.mu.Lock()
	if fs.closing {
		fs.mu.Unlock()
		return ErrLaunchCancelled
	}
	if _, exists := fs.instances[id]; exists {
		fs.mu.Unlock()
		return ErrAlreadyRunning
	}
	fs.instances[id] = inst
	fs.mu.Unlock()
	return fs.startReserved(id, inst)
}

func (fs *Service) startReserved(id string, inst *instance) error {
	svr, cfg, hash, certFiles, err := fs.newClient(&id)
	if err != nil {
		fs.destroying(id, inst)
		return err
	}
	ctx, cancel := context.WithCancel(xlog.NewContext(fs.ctx, newServerLogger(id)))
	fs.mu.Lock()
	if inst.stopRequested || fs.closing {
		fs.mu.Unlock()
		cancel()
		svr.Close()
		fs.destroying(id, inst)
		return ErrLaunchCancelled
	}
	inst.svr, inst.common, inst.cancel = svr, cfg, cancel
	inst.sourceHash, inst.certFiles = hash, certFiles
	inst.graceful = cfg.Transport.Protocol == "kcp" || cfg.Transport.Protocol == "quic"
	fs.mu.Unlock()

	// No database write happens under fs.mu: repository/PB callbacks may reenter us.
	if err := fs.serverRepo.UpdateBootStatus(id, serverdomain.ServerStatusRunning); err != nil {
		cancel()
		svr.Close()
		fs.destroying(id, inst)
		return err
	}
	// Always reconcile after publishing svr. A hook/timer may have fired while
	// newClient held the startup snapshot and svr was still nil.
	if err := fs.ReconcileServer(id); err != nil {
		cancel()
		svr.Close()
		fs.destroying(id, inst)
		return err
	}
	done := make(chan error, 1)
	go func() { done <- svr.Run(ctx) }()
	go fs.monitorServiceStatus(id, inst, ctx, done)
	return nil
}

func (fs *Service) newClient(serverId *string) (*client.Service, *v1.ClientCommonConfig, [32]byte, map[string]bool, error) {
	var hash [32]byte
	cfg, err := fs.buildCommonCfg(serverId)
	if err != nil {
		return nil, nil, hash, nil, err
	}
	hash = commonHash(cfg)
	if err := fs.materializeCommon(*serverId, cfg); err != nil {
		return nil, nil, hash, nil, err
	}
	proxyCfgs, err := fs.genProxyCfgs(serverId)
	if err != nil {
		return nil, nil, hash, nil, err
	}
	visitorCfgs, err := fs.genVisitorCfgs(serverId)
	if err != nil {
		return nil, nil, hash, nil, err
	}
	if err := fs.writePluginCerts(*serverId, proxyCfgs); err != nil {
		return nil, nil, hash, nil, err
	}
	// Log only an allowlisted summary, never the full configuration.
	fs.logConfigSummary(*serverId, "FRP configuration prepared", len(proxyCfgs), len(visitorCfgs))
	if err := cfg.Complete(); err != nil {
		return nil, nil, hash, nil, err
	}
	fs.logger.ensure(cfg.Log.To, cfg.Log.Level, int(cfg.Log.MaxDays))
	configSrc := frpcsource.NewConfigSource()
	if err := configSrc.ReplaceAll(proxyCfgs, visitorCfgs); err != nil {
		return nil, nil, hash, nil, err
	}
	svr, err := client.NewService(client.ServiceOptions{Common: cfg, ConfigSourceAggregator: frpcsource.NewAggregator(configSrc)})
	if err != nil {
		return nil, nil, hash, nil, err
	}
	return svr, cfg, hash, pluginFiles(proxyCfgs), nil
}

// monitorServiceStatus monitors service status and updates the database.
func (fs *Service) monitorServiceStatus(id string, inst *instance, ctx context.Context, done <-chan error) {
	defer fs.destroying(id, inst)

	select {
	case err := <-done:
		fs.app.Logger().Error("Service exited during startup", "id", id)
		if fs.observer != nil && ctx.Err() == nil {
			fs.observer.FrpcExited(id, fs.serverName(id), err)
		}
		return
	case <-ctx.Done():
		fs.app.Logger().Info("Service context cancelled during startup", "id", id)
		<-done
		if fs.observer != nil {
			fs.observer.ServerStopped(id)
		}
		return
	case <-time.After(2 * time.Second):
		fs.app.Logger().Info("Service is running", "id", id)
	}

	proxyDone := make(chan struct{})
	go func() { defer close(proxyDone); fs.monitorProxyStatus(id, inst.svr, ctx) }()
	// Stop and join the status writer before final offline status is persisted.
	defer func() { inst.cancel(); <-proxyDone }()

	select {
	case err := <-done:
		if err != nil {
			fs.app.Logger().Error("Service exited with error", "id", id)
		} else {
			fs.app.Logger().Info("Service exited normally", "id", id)
		}
		if fs.observer != nil && ctx.Err() == nil {
			fs.observer.FrpcExited(id, fs.serverName(id), err)
		}
	case <-ctx.Done():
		fs.app.Logger().Info("Service stopped by user", "id", id)
		<-done
		if fs.observer != nil {
			fs.observer.ServerStopped(id)
		}
	}
}

// destroying cleans up an instance. A newer instance of the same server may
// already have been launched; in that case its map entry and status are left alone.
func (fs *Service) destroying(id string, inst *instance) {
	inst.reloadMu.Lock()
	fs.mu.Lock()
	current := fs.instances[id] == inst
	inst.exiting = true
	fs.mu.Unlock()
	inst.reloadMu.Unlock()
	// Keep the slot reserved until status writes finish; a new launch cannot have
	// its running status overwritten by an older instance's cleanup.
	if current {
		fs.serverRepo.UpdateBootStatus(id, serverdomain.ServerStatusStopped)
		fs.proxyRepo.UpdateBootStatusByServerID(id, proxydomain.ProxyBootStatusOffline)
	}
	if inst.cancel != nil {
		inst.cancel()
	}
	fs.mu.Lock()
	var next *instance
	if fs.instances[id] == inst {
		if t := fs.reloadTimers[id]; t != nil {
			t.Stop()
			delete(fs.reloadTimers, id)
		}
		if inst.restartRequested && !inst.stopRequested && !fs.closing {
			next = &instance{stopped: make(chan struct{})}
			fs.instances[id] = next
		} else {
			delete(fs.instances, id)
		}
	}
	close(inst.stopped)
	fs.mu.Unlock()
	if next != nil {
		go func() {
			if err := fs.startReserved(id, next); err != nil {
				fs.app.Logger().Error("Frpc restart failed; server stopped", "serverId", id)
			}
		}()
	}
}

// monitorProxyStatus monitors proxy status from frp and updates the database.
func (fs *Service) monitorProxyStatus(serverId string, svr *client.Service, ctx context.Context) {
	fs.app.Logger().Info("Starting proxy status monitoring", "serverId", serverId)

	statusExporter := svr.StatusExporter()

	ticker := time.NewTicker(notify.ProxyCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			fs.app.Logger().Info("Proxy status monitoring stopped", "serverId", serverId)
			return
		case <-ticker.C:
			proxies, err := fs.proxyRepo.FindByServerID(serverId)
			if err != nil {
				fs.app.Logger().Error("Failed to get proxies", "serverId", serverId, "error", err)
				continue
			}

			states := make([]notify.ProxyState, 0, len(proxies))
			for _, proxy := range proxies {
				baseName := proxy.Name + "-" + proxy.Id
				bootStatus := proxydomain.ProxyBootStatusOffline
				// A proxy missing from frp is disabled or removed, so it stays offline.
				if status, exists := statusExporter.GetProxyStatus(baseName); exists && status.Phase == "running" {
					bootStatus = proxydomain.ProxyBootStatusOnline
				}
				fs.proxyRepo.UpdateBootStatus(proxy.Id, bootStatus)
				if proxy.Status == string(proxydomain.ProxyStatusEnabled) {
					states = append(states, notify.ProxyState{
						ID: proxy.Id, Name: proxy.Name, Online: bootStatus == proxydomain.ProxyBootStatusOnline,
					})
				}
			}
			if fs.observer != nil && ctx.Err() == nil {
				fs.observer.ObserveProxies(serverId, fs.serverName(serverId), states)
			}
		}
	}
}

// TerminateFrpc stops the specified frpc service and waits for it to exit.
func (fs *Service) TerminateFrpc(id *string) error {
	if id == nil || !validServerID.MatchString(*id) {
		return errors.New("invalid server id")
	}
	fs.app.Logger().Info("Stop frpc", "id", *id)
	fs.mu.Lock()
	if t := fs.reloadTimers[*id]; t != nil {
		t.Stop()
		delete(fs.reloadTimers, *id)
	}
	inst, exists := fs.instances[*id]
	var cancel context.CancelFunc
	if exists {
		inst.stopRequested = true
		inst.restartRequested = false
		cancel = inst.cancel
	}
	fs.mu.Unlock()
	if !exists {
		return nil
	}

	if cancel != nil {
		cancel()
	}
	select {
	case <-inst.stopped:
		fs.app.Logger().Info("Frpc stopped", "id", *id)
	case <-time.After(stopTimeout):
		fs.app.Logger().Warn("Timed out waiting for frpc to stop", "id", *id)
		return errors.New("timed out waiting for frpc to stop")
	}
	return nil
}

// StopAll stops every running frpc service, closing kcp/quic sessions gracefully.
// It is meant to be called on application shutdown.
func (fs *Service) StopAll() {
	fs.mu.Lock()
	fs.closing = true
	for id, t := range fs.reloadTimers {
		t.Stop()
		delete(fs.reloadTimers, id)
	}
	instances := make([]*instance, 0, len(fs.instances))
	var closers []func()
	for _, inst := range fs.instances {
		inst.stopRequested = true
		inst.restartRequested = false
		instances = append(instances, inst)
		if svr := inst.svr; svr != nil {
			if inst.graceful {
				closers = append(closers, func() { svr.GracefulClose(500 * time.Millisecond) })
			} else {
				closers = append(closers, svr.Close)
			}
		}
	}
	fs.mu.Unlock()
	for _, closeService := range closers {
		closeService()
	}
	// Set frp's graceful-close duration before cancelling its parent context.
	fs.cancel()
	timeout := time.NewTimer(stopTimeout)
	defer timeout.Stop()
	for _, inst := range instances {
		select {
		case <-inst.stopped:
		case <-timeout.C:
			return
		}
	}
}

func (fs *Service) getFrpMainPath(id *string) string {
	return filepath.Join(fs.app.DataDir(), "frpc", *id)
}

// StreamLog streams a server's frpc log lines via SSE.
// It sends the server's last 50 lines followed by a replay-end event, then tails
// new lines every 500ms until ctx is done. It returns ErrLogNotFound, without
// writing anything, when there is no log file yet.
func (fs *Service) StreamLog(serverId string, ctx context.Context, w http.ResponseWriter, flusher http.Flusher) error {
	filter, err := fs.logFilter(serverId)
	if err != nil {
		return err
	}

	logPath := sharedLogPath(fs.app.DataDir())
	file, err := os.Open(logPath)
	if errors.Is(err, os.ErrNotExist) {
		return ErrLogNotFound
	}
	if err != nil {
		return err
	}
	defer func() { file.Close() }()

	initialLines := tailMatching(file, 50, 4<<20, filter.apply)
	fs.app.Logger().Debug("Streaming log file", "serverId", serverId, "initialLines", len(initialLines))
	for _, line := range initialLines {
		fmt.Fprintf(w, "data: %s\n\n", line)
	}
	fmt.Fprint(w, replayEndFrame)
	flusher.Flush()

	offset, err := file.Seek(0, io.SeekEnd)
	if err != nil {
		return nil
	}

	var reader lineReader
	buf := make([]byte, 64*1024)
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			fi, err := os.Stat(logPath)
			if err != nil {
				continue
			}

			// The file was rotated or truncated: start over from the new file.
			if fi.Size() < offset {
				newFile, err := os.Open(logPath)
				if err != nil {
					continue
				}
				file.Close()
				file = newFile
				offset = 0
				reader.reset()
			}

			hasData := false
			for {
				n, err := file.ReadAt(buf, offset)
				offset += int64(n)
				for _, line := range reader.feed(buf[:n]) {
					if s, ok := filter.apply(line); ok {
						fmt.Fprintf(w, "data: %s\n\n", s)
						hasData = true
					}
				}
				if err != nil || n < len(buf) {
					break
				}
			}

			if hasData {
				flusher.Flush()
			}
		}
	}
}

// ReloadFrpc pushes the current proxy configuration to a running frpc.
// It does nothing when the server is not running.
func (fs *Service) ReloadFrpc(serverId *string) error {
	if serverId == nil || !validServerID.MatchString(*serverId) {
		return errors.New("invalid server id")
	}
	return fs.ReconcileServer(*serverId)
}

// IsServerRunning checks if a server is currently running or starting.
func (fs *Service) IsServerRunning(serverId string) bool {
	fs.mu.Lock()
	_, exists := fs.instances[serverId]
	fs.mu.Unlock()
	return exists
}

// AutoStartServers automatically starts all servers with autoConnection=true.
func (fs *Service) AutoStartServers() {
	fs.app.Logger().Info("Auto-starting servers with autoConnection enabled")
	fs.app.Logger().Info("Waiting for 10 seconds before auto-starting servers")
	if !waitContext(fs.ctx, 10*time.Second) {
		return
	}

	records, err := fs.serverRepo.FindAllWithAutoConnect()
	if err != nil {
		fs.app.Logger().Error("Failed to find auto-connection servers", "error", err)
		return
	}

	for i, record := range records {
		if fs.ctx.Err() != nil {
			return
		}
		if i > 0 && !waitContext(fs.ctx, time.Second) {
			return
		}
		id := record.ID
		// The setting may have been disabled or the record deleted during the delay.
		current, err := fs.app.FindRecordById("fh_servers", id)
		if err != nil || !current.GetBool("autoConnection") {
			continue
		}
		fs.app.Logger().Info("Auto-starting server", "id", id, "name", record.ServerName)
		if err := fs.LaunchFrpc(&id); err != nil {
			fs.app.Logger().Error("Failed to auto-start server", "id", id)
		} else {
			fs.app.Logger().Info("Successfully auto-started server", "id", id)
		}
	}

	fs.app.Logger().Info("Auto-start initiated for servers", "count", len(records))
}

func waitContext(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return ctx.Err() == nil
	}
}

// isEmptyOption reports whether an options value means "not set": "", nil, or an empty list/object.
func isEmptyOption(v interface{}) bool {
	switch t := v.(type) {
	case nil:
		return true
	case string:
		return t == ""
	case []interface{}:
		return len(t) == 0
	case map[string]interface{}:
		for _, inner := range t {
			if !isEmptyOption(inner) {
				return false
			}
		}
		return true
	}
	return false
}

// logFilter picks the log lines of a server (at its configured level), or every
// line for AllServers.
func (fs *Service) logFilter(serverID string) (lineFilter, error) {
	if serverID == AllServers {
		names := map[string]string{}
		records, err := fs.app.FindAllRecords("fh_servers")
		if err != nil {
			return lineFilter{}, err
		}
		for _, r := range records {
			names[r.Id] = r.GetString("serverName")
		}
		return newAllFilter(names), nil
	}
	if !validServerID.MatchString(serverID) {
		return lineFilter{}, errors.New("invalid server id")
	}
	levelStr := "info"
	if record, err := fs.app.FindRecordById("fh_servers", serverID); err == nil {
		var logConfig v1.LogConfig
		if err := unmarshalField(record.GetString("log"), &logConfig); err == nil && logConfig.Level != "" {
			levelStr = logConfig.Level
		}
	}
	return newLineFilter(serverID, levelStr), nil
}

// WriteLog writes today's log lines of a server (or AllServers) to w, for download.
func (fs *Service) WriteLog(serverID string, w io.Writer) error {
	filter, err := fs.logFilter(serverID)
	if err != nil {
		return err
	}
	file, err := os.Open(sharedLogPath(fs.app.DataDir()))
	if errors.Is(err, os.ErrNotExist) {
		return ErrLogNotFound
	}
	if err != nil {
		return err
	}
	defer file.Close()

	var reader lineReader
	buf := make([]byte, 64*1024)
	for {
		n, err := file.Read(buf)
		for _, line := range reader.feed(buf[:n]) {
			if s, ok := filter.apply(line); ok {
				if _, werr := io.WriteString(w, s+"\n"); werr != nil {
					return werr
				}
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
	}
}
