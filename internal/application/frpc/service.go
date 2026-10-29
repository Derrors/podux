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

	proxydomain "podux/internal/domain/proxy"
	serverdomain "podux/internal/domain/server"

	"github.com/fatedier/frp/client"
	frpcsource "github.com/fatedier/frp/pkg/config/source"
	v1 "github.com/fatedier/frp/pkg/config/v1"
	"github.com/fatedier/frp/pkg/util/xlog"
	"github.com/pocketbase/pocketbase/core"
)

var validServerID = regexp.MustCompile(`^[a-z0-9]{15}$`)
var sensitiveRegex = regexp.MustCompile(`"(?i)(token|password|sk|pwd|secretkey|httpuser|httppwd|oidctoken|oidcclientsecret)":"(?:[^"\\]|\\.)*"`)

// ErrAlreadyRunning is returned when launching a server that is already running or starting.
var ErrAlreadyRunning = errors.New("frpc is already running for this server")

// ErrLogNotFound is returned by StreamLog when no frpc log file exists yet.
var ErrLogNotFound = errors.New("no frpc log file yet")

// replayEndFrame marks the end of the replayed history in a log stream, so the
// client can merge it with lines it already shows.
const replayEndFrame = "event: replay-end\ndata:\n\n"

const stopTimeout = 10 * time.Second

// instance is one running frpc client. svr is nil while the instance is still starting.
type instance struct {
	svr      *client.Service
	cancel   context.CancelFunc
	graceful bool
	stopped  chan struct{}
}

type Service struct {
	mu         sync.Mutex
	app        core.App
	instances  map[string]*instance
	serverRepo serverdomain.Repository
	proxyRepo  proxydomain.Repository
	logger     sharedLogger
}

func NewService(app core.App, serverRepo serverdomain.Repository, proxyRepo proxydomain.Repository) *Service {
	return &Service{
		app:        app,
		instances:  make(map[string]*instance),
		serverRepo: serverRepo,
		proxyRepo:  proxyRepo,
	}
}

// unmarshalField decodes a JSON field, treating an empty value as "not set".
func unmarshalField(raw string, v any) error {
	if raw == "" || raw == "null" {
		return nil
	}
	return json.Unmarshal([]byte(raw), v)
}

func (fs *Service) genCommonCfgs(id *string) (*v1.ClientCommonConfig, error) {
	if !validServerID.MatchString(*id) {
		return nil, errors.New("invalid server id")
	}
	cfg := &v1.ClientCommonConfig{}

	record, err := fs.app.FindRecordById("fh_servers", *id)
	if err != nil {
		return nil, err
	}
	// basic config
	cfg.ServerAddr = record.GetString("serverAddr")
	cfg.ServerPort = record.GetInt("serverPort")
	cfg.User = record.GetString("user")

	mainPath := fs.getFrpMainPath(id)

	// log config: all servers share one log file (see logs.go)
	var logConfig v1.LogConfig
	if err := unmarshalField(record.GetString("log"), &logConfig); err != nil {
		return nil, fmt.Errorf("parse log config: %w", err)
	}
	logConfig.To = sharedLogPath()
	cfg.Log = logConfig

	// auth config
	var authConfig v1.AuthClientConfig
	if err := unmarshalField(record.GetString("auth"), &authConfig); err != nil {
		return nil, fmt.Errorf("parse auth config: %w", err)
	}
	if authConfig.Method != "none" && authConfig.Method != "" {
		cfg.Auth = authConfig
	}

	// transport config
	var transportConfig v1.ClientTransportConfig
	if err := unmarshalField(record.GetString("transport"), &transportConfig); err != nil {
		return nil, fmt.Errorf("parse transport config: %w", err)
	}
	cfg.Transport = transportConfig
	// frp enables TLS when the field is omitted
	if cfg.Transport.TLS.Enable == nil || *cfg.Transport.TLS.Enable {
		certsDir := filepath.Join(mainPath, "certs")
		hasCert := cfg.Transport.TLS.CertFile != "" && cfg.Transport.TLS.KeyFile != ""
		hasCa := cfg.Transport.TLS.TrustedCaFile != ""

		if hasCert || hasCa {
			if err := os.MkdirAll(certsDir, 0700); err != nil {
				return nil, err
			}
		}
		if hasCert {
			tlsCertFile := filepath.Join(certsDir, "cert.pem")
			tlsKeyFile := filepath.Join(certsDir, "key.pem")
			if err := os.WriteFile(tlsCertFile, []byte(cfg.Transport.TLS.CertFile), 0644); err != nil {
				return nil, err
			}
			if err := os.WriteFile(tlsKeyFile, []byte(cfg.Transport.TLS.KeyFile), 0600); err != nil {
				return nil, err
			}
			cfg.Transport.TLS.CertFile = tlsCertFile
			cfg.Transport.TLS.KeyFile = tlsKeyFile
		} else {
			cfg.Transport.TLS.CertFile = ""
			cfg.Transport.TLS.KeyFile = ""
		}
		if hasCa {
			tlsTrustedCaFile := filepath.Join(certsDir, "ca.pem")
			if err := os.WriteFile(tlsTrustedCaFile, []byte(cfg.Transport.TLS.TrustedCaFile), 0644); err != nil {
				return nil, err
			}
			cfg.Transport.TLS.TrustedCaFile = tlsTrustedCaFile
		} else {
			cfg.Transport.TLS.TrustedCaFile = ""
		}
	}

	// metadata config
	var metadataConfig map[string]string
	if err := unmarshalField(record.GetString("metadatas"), &metadataConfig); err != nil {
		return nil, fmt.Errorf("parse metadatas: %w", err)
	}
	cfg.Metadatas = metadataConfig
	return cfg, nil
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

		if proxyMap.ProxyType == "http" || proxyMap.ProxyType == "https" {
			delete(proxyData, "remotePort")
		}
		proxyData["type"] = proxyMap.ProxyType
		delete(proxyData, "proxyType")
		proxyData["name"] = proxyMap.Name + "-" + proxyMap.Id

		// Remove empty plugin map so frp doesn't try to parse a typeless plugin
		if plugin, ok := proxyData["plugin"].(map[string]interface{}); ok {
			if _, hasType := plugin["type"]; !hasType {
				delete(proxyData, "plugin")
			}
		}

		jsonData, err = json.Marshal(proxyData)
		if err != nil {
			return nil, err
		}

		switch proxyMap.ProxyType {
		case "tcp":
			var tcpProxy v1.TCPProxyConfig
			if err := json.Unmarshal(jsonData, &tcpProxy); err != nil {
				return nil, err
			}
			proxyCfgs = append(proxyCfgs, &tcpProxy)
		case "udp":
			var udpProxy v1.UDPProxyConfig
			if err := json.Unmarshal(jsonData, &udpProxy); err != nil {
				return nil, err
			}
			proxyCfgs = append(proxyCfgs, &udpProxy)
		case "http":
			var httpProxy v1.HTTPProxyConfig
			if err := json.Unmarshal(jsonData, &httpProxy); err != nil {
				return nil, err
			}
			proxyCfgs = append(proxyCfgs, &httpProxy)
		case "https":
			var httpsProxy v1.HTTPSProxyConfig
			if err := json.Unmarshal(jsonData, &httpsProxy); err != nil {
				return nil, err
			}
			proxyCfgs = append(proxyCfgs, &httpsProxy)
		}
	}

	return proxyCfgs, nil
}

// LaunchFrpc starts frpc for a server. It returns ErrAlreadyRunning if the
// server is already running or another launch is in progress.
func (fs *Service) LaunchFrpc(serverId *string) error {
	id := *serverId
	fs.app.Logger().Info("Launch frpc", "id", id)

	// Reserve the slot first so concurrent launches of the same server fail fast.
	inst := &instance{stopped: make(chan struct{})}
	fs.mu.Lock()
	if _, exists := fs.instances[id]; exists {
		fs.mu.Unlock()
		return ErrAlreadyRunning
	}
	fs.instances[id] = inst
	fs.mu.Unlock()

	svr, cfg, err := fs.newClient(&id)
	if err != nil {
		fs.mu.Lock()
		delete(fs.instances, id)
		fs.mu.Unlock()
		close(inst.stopped)
		return err
	}

	ctx, cancel := context.WithCancel(xlog.NewContext(context.Background(), newServerLogger(id)))
	fs.mu.Lock()
	inst.svr = svr
	inst.cancel = cancel
	inst.graceful = cfg.Transport.Protocol == "kcp" || cfg.Transport.Protocol == "quic"
	fs.serverRepo.UpdateBootStatus(id, serverdomain.ServerStatusRunning)
	fs.mu.Unlock()

	done := make(chan error, 1)
	go func() {
		fs.app.Logger().Info("Frpc service starting execution", "id", id)
		err := svr.Run(ctx)
		if err != nil {
			fs.app.Logger().Error("Frpc service exited with error", "id", id, "error", err)
		} else {
			fs.app.Logger().Info("Frpc service exited normally", "id", id)
		}
		done <- err
	}()

	go fs.monitorServiceStatus(id, inst, ctx, done)

	return nil
}

func (fs *Service) newClient(serverId *string) (*client.Service, *v1.ClientCommonConfig, error) {
	cfg, err := fs.genCommonCfgs(serverId)
	if err != nil {
		return nil, nil, err
	}

	proxyCfgs, err := fs.genProxyCfgs(serverId)
	if err != nil {
		return nil, nil, err
	}

	fs.app.Logger().Debug("Config", "serverAddr", cfg.ServerAddr, "serverPort", cfg.ServerPort, "proxyCount", len(proxyCfgs))

	// Print frp configurations in logs with sensitive data masked
	commonCfgBytes, _ := json.Marshal(cfg)
	proxyCfgsBytes, _ := json.Marshal(proxyCfgs)

	safeCommon := sensitiveRegex.ReplaceAll(commonCfgBytes, []byte(`"${1}":"***"`))
	safeProxies := sensitiveRegex.ReplaceAll(proxyCfgsBytes, []byte(`"${1}":"***"`))

	fs.app.Logger().Info("FRP Configuration", "common", string(safeCommon), "proxies", string(safeProxies))

	if err := cfg.Complete(); err != nil {
		return nil, nil, err
	}
	fs.logger.ensure(cfg.Log.Level, int(cfg.Log.MaxDays))

	configSrc := frpcsource.NewConfigSource()
	if err := configSrc.ReplaceAll(proxyCfgs, nil); err != nil {
		return nil, nil, err
	}
	svr, err := client.NewService(client.ServiceOptions{
		Common:                 cfg,
		ConfigSourceAggregator: frpcsource.NewAggregator(configSrc),
	})
	if err != nil {
		fs.app.Logger().Error("NewService", "err", err)
		return nil, nil, err
	}
	return svr, cfg, nil
}

// monitorServiceStatus monitors service status and updates the database.
func (fs *Service) monitorServiceStatus(id string, inst *instance, ctx context.Context, done <-chan error) {
	defer fs.destroying(id, inst)

	select {
	case err := <-done:
		fs.app.Logger().Error("Service exited during startup", "id", id, "error", err)
		return
	case <-ctx.Done():
		fs.app.Logger().Info("Service context cancelled during startup", "id", id)
		<-done
		return
	case <-time.After(2 * time.Second):
		fs.app.Logger().Info("Service is running", "id", id)
	}

	go fs.monitorProxyStatus(id, inst.svr, ctx)

	select {
	case err := <-done:
		if err != nil {
			fs.app.Logger().Error("Service exited with error", "id", id, "error", err)
		} else {
			fs.app.Logger().Info("Service exited normally", "id", id)
		}
	case <-ctx.Done():
		fs.app.Logger().Info("Service stopped by user", "id", id)
		<-done
	}
}

// destroying cleans up an instance. A newer instance of the same server may
// already have been launched; in that case its map entry and status are left alone.
func (fs *Service) destroying(id string, inst *instance) {
	fs.mu.Lock()
	if cur, ok := fs.instances[id]; !ok || cur == inst {
		delete(fs.instances, id)
		fs.serverRepo.UpdateBootStatus(id, serverdomain.ServerStatusStopped)
		fs.proxyRepo.UpdateBootStatusByServerID(id, proxydomain.ProxyBootStatusOffline)
	}
	fs.mu.Unlock()
	inst.cancel()
	close(inst.stopped)
}

// monitorProxyStatus monitors proxy status from frp and updates the database.
func (fs *Service) monitorProxyStatus(serverId string, svr *client.Service, ctx context.Context) {
	fs.app.Logger().Info("Starting proxy status monitoring", "serverId", serverId)

	statusExporter := svr.StatusExporter()

	ticker := time.NewTicker(5 * time.Second)
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

			for _, proxy := range proxies {
				baseName := proxy.Name + "-" + proxy.Id
				bootStatus := proxydomain.ProxyBootStatusOffline
				// A proxy missing from frp is disabled or removed, so it stays offline.
				if status, exists := statusExporter.GetProxyStatus(baseName); exists && status.Phase == "running" {
					bootStatus = proxydomain.ProxyBootStatusOnline
				}
				fs.proxyRepo.UpdateBootStatus(proxy.Id, bootStatus)
			}
		}
	}
}

// TerminateFrpc stops the specified frpc service and waits for it to exit.
func (fs *Service) TerminateFrpc(id *string) error {
	fs.app.Logger().Info("Stop frpc", "id", *id)

	fs.mu.Lock()
	inst, exists := fs.instances[*id]
	var cancel context.CancelFunc
	if exists {
		cancel = inst.cancel
	}
	fs.mu.Unlock()
	if !exists {
		return nil
	}
	if cancel == nil {
		return errors.New("frpc is still starting, try again shortly")
	}

	cancel()
	select {
	case <-inst.stopped:
		fs.app.Logger().Info("Frpc stopped", "id", *id)
	case <-time.After(stopTimeout):
		fs.app.Logger().Warn("Timed out waiting for frpc to stop", "id", *id)
	}
	return nil
}

// StopAll stops every running frpc service, closing kcp/quic sessions gracefully.
// It is meant to be called on application shutdown.
func (fs *Service) StopAll() {
	fs.mu.Lock()
	instances := make([]*instance, 0, len(fs.instances))
	for _, inst := range fs.instances {
		if inst.svr != nil {
			instances = append(instances, inst)
		}
	}
	fs.mu.Unlock()

	for _, inst := range instances {
		if inst.graceful {
			inst.svr.GracefulClose(500 * time.Millisecond)
		} else {
			inst.cancel()
		}
	}
	timeout := time.After(stopTimeout)
	for _, inst := range instances {
		select {
		case <-inst.stopped:
		case <-timeout:
			return
		}
	}
}

func (fs *Service) getFrpMainPath(id *string) string {
	return filepath.Join("pb_data", "frpc", *id)
}

// StreamLog streams a server's frpc log lines via SSE.
// It sends the server's last 50 lines followed by a replay-end event, then tails
// new lines every 500ms until ctx is done. It returns ErrLogNotFound, without
// writing anything, when there is no log file yet.
func (fs *Service) StreamLog(serverId string, ctx context.Context, w http.ResponseWriter, flusher http.Flusher) error {
	if !validServerID.MatchString(serverId) {
		return errors.New("invalid server id")
	}

	levelStr := "info"
	if record, err := fs.app.FindRecordById("fh_servers", serverId); err == nil {
		var logConfig v1.LogConfig
		if err := unmarshalField(record.GetString("log"), &logConfig); err == nil && logConfig.Level != "" {
			levelStr = logConfig.Level
		}
	}
	filter := newLineFilter(serverId, levelStr)

	logPath := sharedLogPath()
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
	fs.mu.Lock()
	inst, ok := fs.instances[*serverId]
	fs.mu.Unlock()
	if !ok || inst.svr == nil {
		return nil
	}

	fs.app.Logger().Info("Reload frpc", "id", *serverId)

	proxyCfgs, err := fs.genProxyCfgs(serverId)
	if err != nil {
		return err
	}

	proxyCfgsBytes, _ := json.Marshal(proxyCfgs)
	safeProxies := sensitiveRegex.ReplaceAll(proxyCfgsBytes, []byte(`"${1}":"***"`))
	fs.app.Logger().Info("FRP Reload Configurations", "proxies", string(safeProxies))

	// TODO 2026-02-08 reload visitorCfgs
	return inst.svr.UpdateAllConfigurer(proxyCfgs, nil)
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
	time.Sleep(10 * time.Second)

	records, err := fs.serverRepo.FindAllWithAutoConnect()
	if err != nil {
		fs.app.Logger().Error("Failed to find auto-connection servers", "error", err)
		return
	}

	for i, record := range records {
		if i > 0 {
			time.Sleep(1 * time.Second)
		}
		id := record.ID
		fs.app.Logger().Info("Auto-starting server", "id", id, "name", record.ServerName)
		if err := fs.LaunchFrpc(&id); err != nil {
			fs.app.Logger().Error("Failed to auto-start server", "id", id, "error", err)
		} else {
			fs.app.Logger().Info("Successfully auto-started server", "id", id)
		}
	}

	fs.app.Logger().Info("Auto-start initiated for servers", "count", len(records))
}
