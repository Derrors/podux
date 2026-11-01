// Package frpconfig contains the shared, side-effect-free Podux/frp config boundary.
package frpconfig

import (
	"encoding/json"
	"errors"
	"fmt"

	v1 "github.com/fatedier/frp/pkg/config/v1"
	"github.com/fatedier/frp/pkg/config/v1/validation"
)

type Record interface {
	GetString(string) string
	GetInt(string) int
}

func Decode(raw string, dst any) error {
	if raw == "" || raw == "null" {
		return nil
	}
	return json.Unmarshal([]byte(raw), dst)
}

// Common decodes the persisted shape (including the form's flat OIDC keys).
// It does not read environment variables, access certificate files, or mutate storage.
func Common(r Record) (*v1.ClientCommonConfig, error) {
	c := &v1.ClientCommonConfig{ServerAddr: r.GetString("serverAddr"), ServerPort: r.GetInt("serverPort"), User: r.GetString("user")}
	for _, f := range []struct {
		key string
		dst any
	}{{"auth", &c.Auth}, {"log", &c.Log}, {"transport", &c.Transport}, {"metadatas", &c.Metadatas}} {
		if err := Decode(r.GetString(f.key), f.dst); err != nil {
			return nil, fmt.Errorf("invalid %s configuration", f.key)
		}
	}
	var o struct {
		ClientID           string            `json:"oidcClientId"`
		ClientSecret       string            `json:"oidcClientSecret"`
		Audience           string            `json:"oidcAudience"`
		Scope              string            `json:"oidcScope"`
		TokenEndpoint      string            `json:"oidcTokenEndpoint"`
		AdditionalParams   map[string]string `json:"oidcAdditionalParams"`
		TrustedCa          string            `json:"oidcTrustedCa"`
		InsecureSkipVerify bool              `json:"oidcInsecureSkipVerify"`
	}
	if err := Decode(r.GetString("auth"), &o); err != nil {
		return nil, errors.New("invalid auth configuration")
	}
	if o.ClientID != "" {
		c.Auth.OIDC.ClientID = o.ClientID
	}
	if o.ClientSecret != "" {
		c.Auth.OIDC.ClientSecret = o.ClientSecret
	}
	if o.Audience != "" {
		c.Auth.OIDC.Audience = o.Audience
	}
	if o.Scope != "" {
		c.Auth.OIDC.Scope = o.Scope
	}
	if o.TokenEndpoint != "" {
		c.Auth.OIDC.TokenEndpointURL = o.TokenEndpoint
	}
	if o.TrustedCa != "" {
		c.Auth.OIDC.TrustedCaFile = o.TrustedCa
	}
	if o.InsecureSkipVerify {
		c.Auth.OIDC.InsecureSkipVerify = true
	}
	for k, v := range o.AdditionalParams {
		if k == "" {
			continue
		}
		if c.Auth.OIDC.AdditionalEndpointParams == nil {
			c.Auth.OIDC.AdditionalEndpointParams = map[string]string{}
		}
		c.Auth.OIDC.AdditionalEndpointParams[k] = v
	}
	if err := NormalizeCommon(c); err != nil {
		return nil, err
	}
	return c, nil
}

// NormalizeCommon applies managed defaults consistently for import, export and runtime.
// Complete is deliberately applied to a validation copy: its http_proxy environment
// fallback must never get persisted or exported as if the user had configured it.
func NormalizeCommon(c *v1.ClientCommonConfig) error {
	if c.ServerAddr == "" {
		c.ServerAddr = "0.0.0.0"
	}
	if c.ServerPort == 0 {
		c.ServerPort = 7000
	}
	if c.ServerPort < 1 || c.ServerPort > 65535 {
		return errors.New("invalid server port")
	}
	switch c.Auth.Method {
	case "none":
		c.Auth = v1.AuthClientConfig{Method: v1.AuthMethodToken}
	case "":
		c.Auth.Method = v1.AuthMethodToken
	}
	if c.Auth.Method == v1.AuthMethodOIDC {
		c.Auth.Token = ""
		c.Auth.TokenSource = nil
	} else {
		c.Auth.OIDC = v1.AuthOIDCClientConfig{}
	}
	if c.Log.Level == "" {
		c.Log.Level = "info"
	}
	if c.Log.MaxDays == 0 {
		c.Log.MaxDays = 3
	}
	if c.Transport.Protocol == "" {
		c.Transport.Protocol = "tcp"
	}
	c.Transport.TLS.Complete()
	if !*c.Transport.TLS.Enable {
		c.Transport.TLS.CertFile = ""
		c.Transport.TLS.KeyFile = ""
		c.Transport.TLS.TrustedCaFile = ""
	}
	// An incomplete pair must not turn pasted PEM into a filename downstream.
	if c.Transport.TLS.CertFile == "" || c.Transport.TLS.KeyFile == "" {
		c.Transport.TLS.CertFile = ""
		c.Transport.TLS.KeyFile = ""
	}
	copy := *c
	if err := copy.Complete(); err != nil {
		return errors.New("invalid common configuration")
	}
	if _, err := validation.NewConfigValidator(nil).ValidateClientCommonConfig(&copy); err != nil {
		return fmt.Errorf("invalid common configuration: %w", err)
	}
	return nil
}

func Proxy(c v1.ProxyConfigurer) error {
	c.Complete()
	return validation.ValidateProxyConfigurerForClient(c)
}
func Visitor(c v1.VisitorConfigurer) error {
	c.Complete()
	return validation.ValidateVisitorConfigurer(c)
}
