package notify

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"net/url"
	"strings"
)

// Settings is fh_settings.notifications.
type Settings struct {
	Enabled bool   `json:"enabled"`
	Events  Events `json:"events"`
	// LatencyThresholdMs triggers a high-latency alert when exceeded; 0 disables it.
	LatencyThresholdMs int `json:"latencyThresholdMs"`

	Webhook  WebhookChannel  `json:"webhook"`
	Telegram TelegramChannel `json:"telegram"`
	Bark     BarkChannel     `json:"bark"`
	Email    EmailChannel    `json:"email"`
}

// Events selects which alerts are sent. Recovered covers every "back to normal" message.
type Events struct {
	ServerUnreachable bool `json:"serverUnreachable"`
	HighLatency       bool `json:"highLatency"`
	ProxyDown         bool `json:"proxyDown"`
	FrpcExited        bool `json:"frpcExited"`
	Recovered         bool `json:"recovered"`
}

// Webhook payload formats.
const (
	FormatGeneric  = "generic"  // Podux JSON: event, title, message, server, time
	FormatWeCom    = "wecom"    // WeCom (企业微信) group bot
	FormatDingTalk = "dingtalk" // DingTalk (钉钉) custom bot
	FormatFeishu   = "feishu"   // Feishu/Lark (飞书) custom bot
)

type WebhookChannel struct {
	Enabled bool   `json:"enabled"`
	URL     string `json:"url"`
	Format  string `json:"format"`
}

type TelegramChannel struct {
	Enabled  bool   `json:"enabled"`
	BotToken string `json:"botToken"`
	ChatID   string `json:"chatId"`
	// APIBase overrides https://api.telegram.org, e.g. for a self-hosted Bot API or a mirror.
	APIBase string `json:"apiBase"`
}

type BarkChannel struct {
	Enabled bool `json:"enabled"`
	// ServerURL defaults to https://api.day.app.
	ServerURL string `json:"serverUrl"`
	DeviceKey string `json:"deviceKey"`
}

// EmailChannel sends through the SMTP settings of the PocketBase admin UI (/_/).
type EmailChannel struct {
	Enabled bool   `json:"enabled"`
	To      string `json:"to"`
}

// DefaultSettings is used until notifications are saved: off, all events selected.
func DefaultSettings() Settings {
	return Settings{
		Events: Events{
			ServerUnreachable: true, HighLatency: true, ProxyDown: true, FrpcExited: true, Recovered: true,
		},
		LatencyThresholdMs: 500,
		Webhook:            WebhookChannel{Format: FormatGeneric},
		Bark:               BarkChannel{ServerURL: "https://api.day.app"},
	}
}

// parseSettings decodes stored settings over the defaults, so missing keys keep defaults.
func parseSettings(raw string) (Settings, error) {
	s := DefaultSettings()
	if raw == "" || raw == "null" {
		return s, nil
	}
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		return DefaultSettings(), err
	}
	return s, nil
}

// Validate checks the fields of enabled channels.
func (s Settings) Validate() error {
	var errs []error
	if s.LatencyThresholdMs < 0 {
		errs = append(errs, errors.New("latencyThresholdMs must not be negative"))
	}
	if s.Webhook.Enabled {
		if err := checkHTTPURL(s.Webhook.URL); err != nil {
			errs = append(errs, fmt.Errorf("webhook.url: %w", err))
		}
		switch s.Webhook.Format {
		case "", FormatGeneric, FormatWeCom, FormatDingTalk, FormatFeishu:
		default:
			errs = append(errs, fmt.Errorf("webhook.format: unknown format %q", s.Webhook.Format))
		}
	}
	if s.Telegram.Enabled {
		if strings.TrimSpace(s.Telegram.BotToken) == "" || strings.TrimSpace(s.Telegram.ChatID) == "" {
			errs = append(errs, errors.New("telegram: botToken and chatId are required"))
		}
		if s.Telegram.APIBase != "" {
			if err := checkHTTPURL(s.Telegram.APIBase); err != nil {
				errs = append(errs, fmt.Errorf("telegram.apiBase: %w", err))
			}
		}
	}
	if s.Bark.Enabled {
		if strings.TrimSpace(s.Bark.DeviceKey) == "" {
			errs = append(errs, errors.New("bark.deviceKey is required"))
		}
		if s.Bark.ServerURL != "" {
			if err := checkHTTPURL(s.Bark.ServerURL); err != nil {
				errs = append(errs, fmt.Errorf("bark.serverUrl: %w", err))
			}
		}
	}
	if s.Email.Enabled {
		if _, err := mail.ParseAddressList(s.Email.To); err != nil {
			errs = append(errs, fmt.Errorf("email.to: %w", err))
		}
	}
	return errors.Join(errs...)
}

func checkHTTPURL(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return err
	}
	if (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errors.New("must be an http(s) URL")
	}
	return nil
}
