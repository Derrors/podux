package importer

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"github.com/pelletier/go-toml/v2"
)

// ==================== TOML Parse Types ====================

type tomlFrpClientConfig struct {
	ServerAddr string              `toml:"serverAddr"`
	ServerPort int                 `toml:"serverPort"`
	User       string              `toml:"user"`
	Auth       tomlAuthConfig      `toml:"auth"`
	Log        tomlLogConfig       `toml:"log"`
	Transport  tomlTransportConfig `toml:"transport"`
	Metadatas  map[string]string   `toml:"metadatas"`
	Proxies    []tomlProxyConfig   `toml:"proxies"`
	Visitors   []tomlVisitorConfig `toml:"visitors"`
}

type tomlAuthConfig struct {
	Method string `toml:"method"`
	Token  string `toml:"token"`
}

type tomlLogConfig struct {
	Level   string `toml:"level"`
	MaxDays int    `toml:"maxDays"`
}

type tomlTransportConfig struct {
	Protocol string        `toml:"protocol"`
	ProxyURL string        `toml:"proxyURL"`
	TLS      tomlTLSConfig `toml:"tls"`
}

type tomlTLSConfig struct {
	Enable                    *bool  `toml:"enable"`
	DisableCustomTLSFirstByte bool   `toml:"disableCustomTLSFirstByte"`
	ServerName                string `toml:"serverName"`
	CertFile                  string `toml:"certFile"`
	KeyFile                   string `toml:"keyFile"`
	TrustedCaFile             string `toml:"trustedCaFile"`
}

type tomlProxyConfig struct {
	Name          string                 `toml:"name"`
	Type          string                 `toml:"type"`
	LocalIP       string                 `toml:"localIP"`
	LocalPort     int                    `toml:"localPort"`
	RemotePort    int                    `toml:"remotePort"`
	Subdomain     string                 `toml:"subdomain"`
	CustomDomains []string               `toml:"customDomains"`
	Transport     map[string]interface{} `toml:"transport"`
	SecretKey     string                 `toml:"secretKey"`
	AllowUsers    []string               `toml:"allowUsers"`
	HealthCheck   map[string]interface{} `toml:"healthCheck"`
}

type tomlVisitorConfig struct {
	Name           string                 `toml:"name"`
	Type           string                 `toml:"type"`
	ServerName     string                 `toml:"serverName"`
	ServerUser     string                 `toml:"serverUser"`
	SecretKey      string                 `toml:"secretKey"`
	BindAddr       string                 `toml:"bindAddr"`
	BindPort       int                    `toml:"bindPort"`
	KeepTunnelOpen bool                   `toml:"keepTunnelOpen"`
	Transport      map[string]interface{} `toml:"transport"`
}

// ==================== API Data Types ====================

type ParseTomlRequest struct {
	TomlContent string `json:"tomlContent"`
}

type ImportServerInfo struct {
	Name        string                 `json:"name"`
	ServerAddr  string                 `json:"serverAddr"`
	ServerPort  int                    `json:"serverPort"`
	User        string                 `json:"user"`
	Auth        map[string]interface{} `json:"auth"`
	Log         map[string]interface{} `json:"log"`
	Transport   map[string]interface{} `json:"transport"`
	Metadatas   map[string]string      `json:"metadatas"`
	IsDuplicate bool                   `json:"isDuplicate"`
	ExistingId  string                 `json:"existingId"`
}

type ImportProxyInfo struct {
	Name          string                 `json:"name"`
	Type          string                 `json:"type"`
	LocalIP       string                 `json:"localIP"`
	LocalPort     int                    `json:"localPort"`
	RemotePort    int                    `json:"remotePort"`
	Subdomain     string                 `json:"subdomain"`
	CustomDomains []string               `json:"customDomains"`
	Transport     map[string]interface{} `json:"transport"`
	IsDuplicate   bool                   `json:"isDuplicate"`
	ExistingId    string                 `json:"existingId"`
}

type ImportVisitorInfo struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	ServerName  string `json:"serverName"`
	BindAddr    string `json:"bindAddr"`
	BindPort    int    `json:"bindPort"`
	IsDuplicate bool   `json:"isDuplicate"`
}

type ImportPreviewResponse struct {
	Server   ImportServerInfo    `json:"server"`
	Proxies  []ImportProxyInfo   `json:"proxies"`
	Visitors []ImportVisitorInfo `json:"visitors"`
	// Warnings are codes the frontend translates, e.g. WarningTLSFilePathIgnored.
	Warnings []string `json:"warnings,omitempty"`
}

// WarningTLSFilePathIgnored means the TOML referenced TLS files by path. Podux stores
// certificate contents, so the paths were dropped and must be pasted after import.
const WarningTLSFilePathIgnored = "tls_file_path_ignored"

// WarningUnsupportedProxySkipped means the TOML has proxy types Podux can't manage
// (such as tcpmux); they are left out of the preview and the import.
const WarningUnsupportedProxySkipped = "unsupported_proxy_skipped"

// WarningUnsupportedVisitorSkipped means the TOML has visitors whose type is missing
// or not stcp/sudp/xtcp; they are left out of the preview and the import.
const WarningUnsupportedVisitorSkipped = "unsupported_visitor_skipped"

// proxyTypeOf returns the proxy's type (frp defaults to tcp) and whether fh_proxies accepts it.
func proxyTypeOf(p tomlProxyConfig) (string, bool) {
	switch p.Type {
	case "":
		return "tcp", true
	case "tcp", "udp", "http", "https", "stcp", "sudp", "xtcp":
		return p.Type, true
	}
	return p.Type, false
}

// visitorTypeOk reports whether fh_visitors accepts the visitor's type (frp has no default).
func visitorTypeOk(v tomlVisitorConfig) bool {
	return v.Type == "stcp" || v.Type == "sudp" || v.Type == "xtcp"
}

type ProxyImportOption struct {
	Name      string `json:"name"`
	Import    bool   `json:"import"`
	Overwrite bool   `json:"overwrite"`
}

type ExecuteImportRequest struct {
	TomlContent     string              `json:"tomlContent"`
	ServerName      string              `json:"serverName"`
	ImportServer    bool                `json:"importServer"`
	OverwriteServer bool                `json:"overwriteServer"`
	Proxies         []ProxyImportOption `json:"proxies"`
	// ImportVisitors imports every visitor in the TOML; OverwriteVisitors replaces
	// visitors of the same name on the server instead of skipping them.
	ImportVisitors    bool `json:"importVisitors"`
	OverwriteVisitors bool `json:"overwriteVisitors"`
}

type ImportResult struct {
	ServerImported   bool `json:"serverImported"`
	ProxiesImported  int  `json:"proxiesImported"`
	ProxiesSkipped   int  `json:"proxiesSkipped"`
	VisitorsImported int  `json:"visitorsImported"`
	VisitorsSkipped  int  `json:"visitorsSkipped"`
}

// ==================== Service ====================

type Service struct {
	app core.App
}

func NewService(app core.App) *Service {
	return &Service{app: app}
}

func (s *Service) ParseToml(req *ParseTomlRequest) (*ImportPreviewResponse, error) {
	var cfg tomlFrpClientConfig
	if err := toml.Unmarshal([]byte(req.TomlContent), &cfg); err != nil {
		return nil, fmt.Errorf("TOML 解析失败: %w", err)
	}

	serverPort := cfg.ServerPort
	if serverPort == 0 {
		serverPort = 7000
	}

	// Check if server already exists (by addr + port)
	var existingServerId string
	var serverDuplicate bool
	var existingServerRow struct {
		Id string `db:"id"`
	}
	err := s.app.DB().
		Select("id").
		From("fh_servers").
		Where(dbx.HashExp{
			"serverAddr": cfg.ServerAddr,
			"serverPort": serverPort,
		}).
		One(&existingServerRow)
	if err == nil {
		serverDuplicate = true
		existingServerId = existingServerRow.Id
	}

	// Build auth map
	authMap := map[string]interface{}{
		"method": cfg.Auth.Method,
		"token":  cfg.Auth.Token,
	}

	// Build log map with defaults
	logLevel := cfg.Log.Level
	if logLevel == "" {
		logLevel = "info"
	}
	logMaxDays := cfg.Log.MaxDays
	if logMaxDays == 0 {
		logMaxDays = 3
	}
	logMap := map[string]interface{}{
		"level":   logLevel,
		"maxDays": logMaxDays,
	}

	transportMap, warnings := buildTransportMap(cfg.Transport)

	metadatas := cfg.Metadatas
	if metadatas == nil {
		metadatas = map[string]string{}
	}

	serverInfo := ImportServerInfo{
		Name:        fmt.Sprintf("%s:%d", cfg.ServerAddr, serverPort),
		ServerAddr:  cfg.ServerAddr,
		ServerPort:  serverPort,
		User:        cfg.User,
		Auth:        authMap,
		Log:         logMap,
		Transport:   transportMap,
		Metadatas:   metadatas,
		IsDuplicate: serverDuplicate,
		ExistingId:  existingServerId,
	}

	// Build proxy infos with duplicate detection
	proxies := make([]ImportProxyInfo, 0, len(cfg.Proxies))
	for _, p := range cfg.Proxies {
		proxyType, ok := proxyTypeOf(p)
		if !ok {
			if !slices.Contains(warnings, WarningUnsupportedProxySkipped) {
				warnings = append(warnings, WarningUnsupportedProxySkipped)
			}
			continue
		}
		customDomains := p.CustomDomains
		if customDomains == nil {
			customDomains = []string{}
		}
		proxyTransport := p.Transport
		if proxyTransport == nil {
			proxyTransport = map[string]interface{}{}
		}

		proxyInfo := ImportProxyInfo{
			Name:          p.Name,
			Type:          proxyType,
			LocalIP:       p.LocalIP,
			LocalPort:     p.LocalPort,
			RemotePort:    p.RemotePort,
			Subdomain:     p.Subdomain,
			CustomDomains: customDomains,
			Transport:     proxyTransport,
		}

		// Check proxy duplicate: only meaningful if server already exists
		if serverDuplicate && existingServerId != "" {
			var existingProxyRow struct {
				Id string `db:"id"`
			}
			perr := s.app.DB().
				Select("id").
				From("fh_proxies").
				Where(dbx.HashExp{
					"name":     p.Name,
					"serverId": existingServerId,
				}).
				One(&existingProxyRow)
			if perr == nil {
				proxyInfo.IsDuplicate = true
				proxyInfo.ExistingId = existingProxyRow.Id
			}
		}

		proxies = append(proxies, proxyInfo)
	}

	visitors := make([]ImportVisitorInfo, 0, len(cfg.Visitors))
	for _, v := range cfg.Visitors {
		if !visitorTypeOk(v) {
			if !slices.Contains(warnings, WarningUnsupportedVisitorSkipped) {
				warnings = append(warnings, WarningUnsupportedVisitorSkipped)
			}
			continue
		}
		info := ImportVisitorInfo{
			Name: v.Name, Type: v.Type, ServerName: v.ServerName, BindAddr: v.BindAddr, BindPort: v.BindPort,
		}
		if serverDuplicate && existingServerId != "" {
			info.IsDuplicate = s.findVisitorID(s.app, existingServerId, v.Name) != ""
		}
		visitors = append(visitors, info)
	}

	return &ImportPreviewResponse{
		Server:   serverInfo,
		Proxies:  proxies,
		Visitors: visitors,
		Warnings: warnings,
	}, nil
}

func (s *Service) ExecuteImport(req *ExecuteImportRequest) (*ImportResult, error) {
	var cfg tomlFrpClientConfig
	if err := toml.Unmarshal([]byte(req.TomlContent), &cfg); err != nil {
		return nil, fmt.Errorf("TOML 解析失败: %w", err)
	}

	serverPort := cfg.ServerPort
	if serverPort == 0 {
		serverPort = 7000
	}

	result := &ImportResult{}

	err := s.app.RunInTransaction(func(txApp core.App) error {
		serverId, err := s.handleServerImport(txApp, &cfg, serverPort, req, result)
		if err != nil {
			return err
		}
		if serverId == "" {
			return nil
		}
		if err := s.handleProxyImport(txApp, &cfg, serverId, req.Proxies, result); err != nil {
			return err
		}
		return s.handleVisitorImport(txApp, &cfg, serverId, req, result)
	})

	if err != nil {
		return nil, err
	}
	return result, nil
}

// handleServerImport creates or updates a server record and returns its ID.
// Returns empty string if server import was skipped.
func (s *Service) handleServerImport(
	txApp core.App,
	cfg *tomlFrpClientConfig,
	serverPort int,
	req *ExecuteImportRequest,
	result *ImportResult,
) (string, error) {
	var existingServerRow struct {
		Id string `db:"id"`
	}
	serverExists := false
	existErr := txApp.DB().
		Select("id").
		From("fh_servers").
		Where(dbx.HashExp{
			"serverAddr": cfg.ServerAddr,
			"serverPort": serverPort,
		}).
		One(&existingServerRow)
	if existErr == nil {
		serverExists = true
	}

	// Server exists but we're not importing: use existing ID for proxies
	if serverExists && !req.ImportServer {
		return existingServerRow.Id, nil
	}

	// Not importing server and it doesn't exist: skip
	if !req.ImportServer {
		return "", nil
	}

	serverName := req.ServerName
	if serverName == "" {
		serverName = fmt.Sprintf("%s:%d", cfg.ServerAddr, serverPort)
	}

	logLevel := cfg.Log.Level
	if logLevel == "" {
		logLevel = "info"
	}
	logMaxDays := cfg.Log.MaxDays
	if logMaxDays == 0 {
		logMaxDays = 3
	}
	metadatas := cfg.Metadatas
	if metadatas == nil {
		metadatas = map[string]string{}
	}

	authJSON, _ := json.Marshal(map[string]interface{}{
		"method": cfg.Auth.Method,
		"token":  cfg.Auth.Token,
	})
	logJSON, _ := json.Marshal(map[string]interface{}{
		"level":   logLevel,
		"maxDays": logMaxDays,
	})
	transportMap, _ := buildTransportMap(cfg.Transport)
	transportJSON, _ := json.Marshal(transportMap)
	metadatasJSON, _ := json.Marshal(metadatas)

	serversCollection, err := txApp.FindCollectionByNameOrId("fh_servers")
	if err != nil {
		return "", fmt.Errorf("找不到服务器集合: %w", err)
	}

	var serverRecord *core.Record
	if serverExists && req.OverwriteServer {
		serverRecord, err = txApp.FindRecordById(serversCollection, existingServerRow.Id)
		if err != nil {
			return "", fmt.Errorf("查找已有服务器失败: %w", err)
		}
	} else if serverExists && !req.OverwriteServer {
		result.ServerImported = false
		return existingServerRow.Id, nil
	} else {
		serverRecord = core.NewRecord(serversCollection)
	}

	serverRecord.Set("serverName", serverName)
	serverRecord.Set("serverAddr", cfg.ServerAddr)
	serverRecord.Set("serverPort", serverPort)
	serverRecord.Set("user", cfg.User)
	serverRecord.Set("serverVersion", "built-in")
	serverRecord.Set("auth", string(authJSON))
	serverRecord.Set("log", string(logJSON))
	serverRecord.Set("transport", string(transportJSON))
	serverRecord.Set("metadatas", string(metadatasJSON))
	serverRecord.Set("bootStatus", "stopped")
	serverRecord.Set("autoConnection", false)
	serverRecord.Set("description", "")

	if err := txApp.Save(serverRecord); err != nil {
		return "", fmt.Errorf("保存服务器失败: %w", err)
	}

	result.ServerImported = true
	return serverRecord.Id, nil
}

// handleProxyImport creates or updates proxy records under the given server.
func (s *Service) handleProxyImport(
	txApp core.App,
	cfg *tomlFrpClientConfig,
	serverId string,
	proxyOpts []ProxyImportOption,
	result *ImportResult,
) error {
	proxyOptMap := make(map[string]ProxyImportOption, len(proxyOpts))
	for _, opt := range proxyOpts {
		proxyOptMap[opt.Name] = opt
	}

	proxiesCollection, err := txApp.FindCollectionByNameOrId("fh_proxies")
	if err != nil {
		return fmt.Errorf("找不到代理集合: %w", err)
	}

	for _, p := range cfg.Proxies {
		opt, ok := proxyOptMap[p.Name]
		proxyType, supported := proxyTypeOf(p)
		if !ok || !opt.Import || !supported {
			result.ProxiesSkipped++
			continue
		}

		var existingProxyRow struct {
			Id string `db:"id"`
		}
		proxyExistsErr := txApp.DB().
			Select("id").
			From("fh_proxies").
			Where(dbx.HashExp{
				"name":     p.Name,
				"serverId": serverId,
			}).
			One(&existingProxyRow)

		var proxyRecord *core.Record
		if proxyExistsErr == nil && opt.Overwrite {
			proxyRecord, err = txApp.FindRecordById(proxiesCollection, existingProxyRow.Id)
			if err != nil {
				return fmt.Errorf("查找已有代理 %s 失败: %w", p.Name, err)
			}
		} else if proxyExistsErr == nil && !opt.Overwrite {
			result.ProxiesSkipped++
			continue
		} else {
			proxyRecord = core.NewRecord(proxiesCollection)
		}

		customDomains := p.CustomDomains
		if customDomains == nil {
			customDomains = []string{}
		}
		customDomainsJSON, _ := json.Marshal(customDomains)

		proxyTransport := p.Transport
		if proxyTransport == nil {
			proxyTransport = map[string]interface{}{}
		}
		proxyTransportJSON, _ := json.Marshal(proxyTransport)

		proxyRecord.Set("name", p.Name)
		proxyRecord.Set("proxyType", proxyType)
		proxyRecord.Set("serverId", serverId)
		proxyRecord.Set("localIP", p.LocalIP)
		proxyRecord.Set("localPort", p.LocalPort)
		proxyRecord.Set("remotePort", p.RemotePort)
		proxyRecord.Set("subdomain", p.Subdomain)
		proxyRecord.Set("customDomains", string(customDomainsJSON))
		proxyRecord.Set("transport", string(proxyTransportJSON))
		proxyRecord.Set("secretKey", p.SecretKey)
		proxyRecord.Set("allowUsers", p.AllowUsers)
		proxyRecord.Set("healthCheck", p.HealthCheck)
		proxyRecord.Set("status", "enabled")
		proxyRecord.Set("bootStatus", "offline")
		proxyRecord.Set("description", "")

		if err := txApp.Save(proxyRecord); err != nil {
			return fmt.Errorf("保存代理 %s 失败: %w", p.Name, err)
		}
		result.ProxiesImported++
	}

	return nil
}

// handleVisitorImport creates or updates the TOML's visitors under the given server.
func (s *Service) handleVisitorImport(
	txApp core.App,
	cfg *tomlFrpClientConfig,
	serverId string,
	req *ExecuteImportRequest,
	result *ImportResult,
) error {
	if !req.ImportVisitors {
		result.VisitorsSkipped += len(cfg.Visitors)
		return nil
	}
	collection, err := txApp.FindCollectionByNameOrId("fh_visitors")
	if err != nil {
		return fmt.Errorf("找不到访问端集合: %w", err)
	}

	for _, v := range cfg.Visitors {
		if !visitorTypeOk(v) {
			result.VisitorsSkipped++
			continue
		}
		var record *core.Record
		if existingID := s.findVisitorID(txApp, serverId, v.Name); existingID != "" {
			if !req.OverwriteVisitors {
				result.VisitorsSkipped++
				continue
			}
			if record, err = txApp.FindRecordById(collection, existingID); err != nil {
				return fmt.Errorf("查找已有访问端 %s 失败: %w", v.Name, err)
			}
		} else {
			record = core.NewRecord(collection)
			record.Set("status", "enabled")
			record.Set("description", "")
		}

		transport := v.Transport
		if transport == nil {
			transport = map[string]interface{}{}
		}
		record.Set("name", v.Name)
		record.Set("visitorType", v.Type)
		record.Set("serverId", serverId)
		record.Set("serverName", v.ServerName)
		record.Set("serverUser", v.ServerUser)
		record.Set("secretKey", v.SecretKey)
		record.Set("bindAddr", v.BindAddr)
		record.Set("bindPort", v.BindPort)
		record.Set("keepTunnelOpen", v.KeepTunnelOpen)
		record.Set("transport", transport)

		if err := txApp.Save(record); err != nil {
			return fmt.Errorf("保存访问端 %s 失败: %w", v.Name, err)
		}
		result.VisitorsImported++
	}
	return nil
}

// findVisitorID returns the ID of the server's visitor with this name, or "".
func (s *Service) findVisitorID(app core.App, serverId, name string) string {
	var row struct {
		Id string `db:"id"`
	}
	err := app.DB().Select("id").From("fh_visitors").
		Where(dbx.HashExp{"name": name, "serverId": serverId}).
		One(&row)
	if err != nil {
		return ""
	}
	return row.Id
}

// buildTransportMap converts the TOML transport section into the stored JSON shape.
// frp's TOML references TLS files by path while Podux stores their PEM contents,
// so path values are dropped and reported as a warning.
func buildTransportMap(t tomlTransportConfig) (map[string]interface{}, []string) {
	protocol := t.Protocol
	if protocol == "" {
		protocol = "tcp"
	}
	// frp enables TLS unless it is explicitly disabled.
	tlsEnable := t.TLS.Enable == nil || *t.TLS.Enable

	var warnings []string
	pemOnly := func(v string) string {
		if v == "" || strings.Contains(v, "-----BEGIN") {
			return v
		}
		if len(warnings) == 0 {
			warnings = append(warnings, WarningTLSFilePathIgnored)
		}
		return ""
	}

	return map[string]interface{}{
		"protocol": protocol,
		"proxyURL": t.ProxyURL,
		"tls": map[string]interface{}{
			"enable":                    tlsEnable,
			"disableCustomTLSFirstByte": t.TLS.DisableCustomTLSFirstByte,
			"serverName":                t.TLS.ServerName,
			"certFile":                  pemOnly(t.TLS.CertFile),
			"keyFile":                   pemOnly(t.TLS.KeyFile),
			"trustedCaFile":             pemOnly(t.TLS.TrustedCaFile),
		},
	}, warnings
}
