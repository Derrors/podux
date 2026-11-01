package importer

import (
	"encoding/json"
	"fmt"
	v1 "github.com/fatedier/frp/pkg/config/v1"
	"github.com/pelletier/go-toml/v2"
	"podux/internal/frpconfig"
)

func normalizeImportedCommon(cfg *tomlFrpClientConfig) error {
	c := &v1.ClientCommonConfig{ServerAddr: cfg.ServerAddr, ServerPort: cfg.ServerPort}
	c.Auth.Method = v1.AuthMethod(cfg.Auth.Method)
	c.Auth.Token = cfg.Auth.Token
	c.Auth.OIDC = v1.AuthOIDCClientConfig{ClientID: cfg.Auth.OIDC.ClientID, ClientSecret: cfg.Auth.OIDC.ClientSecret, TokenEndpointURL: cfg.Auth.OIDC.TokenEndpointURL}
	for _, s := range cfg.Auth.AdditionalScopes {
		c.Auth.AdditionalScopes = append(c.Auth.AdditionalScopes, v1.AuthScope(s))
	}
	c.Log.Level = cfg.Log.Level
	c.Log.MaxDays = int64(cfg.Log.MaxDays)
	c.Transport.Protocol = cfg.Transport.Protocol
	c.Transport.TLS.Enable = cfg.Transport.TLS.Enable
	c.Transport.TLS.DisableCustomTLSFirstByte = cfg.Transport.TLS.DisableCustomTLSFirstByte
	if err := frpconfig.NormalizeCommon(c); err != nil {
		return err
	}
	cfg.ServerAddr, cfg.ServerPort = c.ServerAddr, c.ServerPort
	cfg.Auth.Method, cfg.Auth.Token = string(c.Auth.Method), c.Auth.Token
	cfg.Log.Level, cfg.Log.MaxDays = c.Log.Level, int(c.Log.MaxDays)
	cfg.Transport.Protocol = c.Transport.Protocol
	cfg.Transport.TLS.Enable = c.Transport.TLS.Enable
	cfg.Transport.TLS.DisableCustomTLSFirstByte = c.Transport.TLS.DisableCustomTLSFirstByte
	// Ambiguous source names would otherwise overwrite entries in the import map.
	for _, names := range [][]string{proxyNames(cfg.Proxies), visitorNames(cfg.Visitors)} {
		seen := map[string]bool{}
		for _, name := range names {
			if seen[name] {
				return fmt.Errorf("duplicate names in imported configuration")
			}
			seen[name] = true
		}
	}
	return nil
}

func proxyNames(proxies []tomlProxyConfig) []string {
	var names []string
	for _, p := range proxies {
		if _, ok := proxyTypeOf(p); ok {
			names = append(names, p.Name)
		}
	}
	return names
}
func visitorNames(visitors []tomlVisitorConfig) []string {
	var names []string
	for _, v := range visitors {
		if visitorTypeOk(v) {
			names = append(names, v.Name)
		}
	}
	return names
}

// Go's JSON tags and TOML tags differ on the import DTOs. Use the TOML field
// names when validating with frp, without introducing a second field mapping.
func nativeConfig(src any, dst any) error {
	b, err := toml.Marshal(src)
	if err != nil {
		return err
	}
	var fields map[string]any
	if err := toml.Unmarshal(b, &fields); err != nil {
		return err
	}
	b, err = json.Marshal(fields)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, dst)
}
func validateProxy(p tomlProxyConfig) error {
	kind, ok := proxyTypeOf(p)
	if !ok {
		return nil
	}
	p.Type = kind
	c := v1.NewProxyConfigurerByType(v1.ProxyType(kind))
	if err := nativeConfig(p, c); err != nil {
		return fmt.Errorf("invalid imported proxy configuration")
	}
	if err := frpconfig.Proxy(c); err != nil {
		return fmt.Errorf("invalid imported proxy configuration: %w", err)
	}
	return nil
}
func validateVisitor(v tomlVisitorConfig) error {
	c := v1.NewVisitorConfigurerByType(v1.VisitorType(v.Type))
	if err := nativeConfig(v, c); err != nil {
		return fmt.Errorf("invalid imported visitor configuration")
	}
	return frpconfig.Visitor(c)
}
