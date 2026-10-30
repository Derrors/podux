package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/mailer"
)

// sendAll delivers m to every enabled channel and returns each channel's error.
func (s *Service) sendAll(ctx context.Context, settings Settings, m Message) map[string]error {
	results := map[string]error{}
	if settings.Webhook.Enabled {
		results["webhook"] = s.sendWebhook(ctx, settings.Webhook, m)
	}
	if settings.Telegram.Enabled {
		results["telegram"] = s.sendTelegram(ctx, settings.Telegram, m)
	}
	if settings.Bark.Enabled {
		results["bark"] = s.sendBark(ctx, settings.Bark, m)
	}
	if settings.Email.Enabled {
		results["email"] = sendEmail(s.app, settings.Email, m)
	}
	return results
}

func (s *Service) sendWebhook(ctx context.Context, c WebhookChannel, m Message) error {
	var payload any
	switch c.Format {
	case FormatWeCom, FormatDingTalk:
		payload = map[string]any{"msgtype": "text", "text": map[string]string{"content": m.Text()}}
	case FormatFeishu:
		payload = map[string]any{"msg_type": "text", "content": map[string]string{"text": m.Text()}}
	default:
		payload = m
	}
	body, err := s.postJSON(ctx, strings.TrimSpace(c.URL), payload)
	if err != nil {
		return err
	}
	// The bot APIs answer HTTP 200 with an error code in the body.
	var reply struct {
		ErrCode *int   `json:"errcode"` // WeCom, DingTalk
		ErrMsg  string `json:"errmsg"`
		Code    *int   `json:"code"` // Feishu
		Msg     string `json:"msg"`
	}
	if json.Unmarshal(body, &reply) == nil {
		if reply.ErrCode != nil && *reply.ErrCode != 0 {
			return fmt.Errorf("errcode %d: %s", *reply.ErrCode, reply.ErrMsg)
		}
		if c.Format == FormatFeishu && reply.Code != nil && *reply.Code != 0 {
			return fmt.Errorf("code %d: %s", *reply.Code, reply.Msg)
		}
	}
	return nil
}

func (s *Service) sendTelegram(ctx context.Context, c TelegramChannel, m Message) error {
	base := strings.TrimRight(strings.TrimSpace(c.APIBase), "/")
	if base == "" {
		base = "https://api.telegram.org"
	}
	url := base + "/bot" + strings.TrimSpace(c.BotToken) + "/sendMessage"
	_, err := s.postJSON(ctx, url, map[string]any{
		"chat_id": strings.TrimSpace(c.ChatID), "text": m.Text(), "disable_web_page_preview": true,
	})
	if err != nil && strings.TrimSpace(c.BotToken) != "" {
		// The URL holds the bot token; never let it reach logs or the UI.
		return errors.New(strings.ReplaceAll(err.Error(), strings.TrimSpace(c.BotToken), "***"))
	}
	return nil
}

func (s *Service) sendBark(ctx context.Context, c BarkChannel, m Message) error {
	base := strings.TrimRight(strings.TrimSpace(c.ServerURL), "/")
	if base == "" {
		base = "https://api.day.app"
	}
	_, err := s.postJSON(ctx, base+"/push", map[string]any{
		"device_key": strings.TrimSpace(c.DeviceKey), "title": m.Title, "body": m.Body, "group": "Podux",
	})
	return err
}

func sendEmail(app core.App, c EmailChannel, m Message) error {
	meta := app.Settings().Meta
	if meta.SenderAddress == "" {
		return errors.New("no sender address: configure Mail settings in the PocketBase admin UI (/_/)")
	}
	to, err := mail.ParseAddressList(c.To)
	if err != nil {
		return err
	}
	recipients := make([]mail.Address, 0, len(to))
	for _, a := range to {
		recipients = append(recipients, *a)
	}
	return app.NewMailClient().Send(&mailer.Message{
		From:    mail.Address{Name: meta.SenderName, Address: meta.SenderAddress},
		To:      recipients,
		Subject: m.Title,
		Text:    m.Body,
	})
}

// postJSON posts payload and returns the response body; non-2xx statuses are errors.
func (s *Service) postJSON(ctx context.Context, url string, payload any) ([]byte, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Podux")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		snippet := strings.TrimSpace(string(body))
		if len(snippet) > 200 {
			snippet = snippet[:200]
		}
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, snippet)
	}
	return body, nil
}
