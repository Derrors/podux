package notify

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"podux/internal/application/system"
	"podux/internal/testutil"

	"github.com/pocketbase/pocketbase/core"
)

// newTestService returns a service with notifications enabled and messages captured.
func newTestService(t *testing.T, lang string, edit func(*Settings)) (*Service, core.App, *[]Message) {
	t.Helper()
	app := testutil.NewApp(t)
	testutil.SaveRecord(t, app, "fh_settings", map[string]any{
		"id": system.SettingsID, "initialized": true, "general": map[string]any{"defaultLanguage": lang},
	})
	s := NewService(app)
	settings := DefaultSettings()
	settings.Enabled = true
	if edit != nil {
		edit(&settings)
	}
	if err := s.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var sent []Message
	s.send = func(m Message) {
		mu.Lock()
		defer mu.Unlock()
		sent = append(sent, m)
	}
	return s, app, &sent
}

func events(msgs []Message) []string {
	out := make([]string, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, m.Event)
	}
	return out
}

func TestServerUnreachableAndLatencyAlerts(t *testing.T) {
	s, app, sent := newTestService(t, "zh", func(s *Settings) { s.LatencyThresholdMs = 200 })
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "home", "serverAddr": "1.1.1.1", "serverPort": 7000})
	probe := func(running, reachable bool, ms int64) {
		s.ObserveLatency(server.Id, "home", "1.1.1.1:7000", running, reachable, ms)
	}

	probe(true, false, -1)
	probe(true, false, -1)
	if len(*sent) != 0 {
		t.Fatalf("alerted before %d failures: %v", failThreshold, events(*sent))
	}
	probe(true, false, -1)
	probe(true, false, -1) // still down: no repeat
	probe(true, true, 30)
	if got := strings.Join(events(*sent), ","); got != "server_unreachable,server_recovered" {
		t.Fatalf("events = %s", got)
	}
	if m := (*sent)[0]; !strings.Contains(m.Title, "服务器不可达: home") || !strings.Contains(m.Body, "1.1.1.1:7000") {
		t.Errorf("message = %+v", m)
	}

	*sent = nil
	for range failThreshold {
		probe(true, true, 500)
	}
	probe(true, true, 50)
	if got := strings.Join(events(*sent), ","); got != "high_latency,latency_recovered" {
		t.Fatalf("latency events = %s", got)
	}

	// A stopped server never alerts.
	*sent = nil
	for range failThreshold + 1 {
		probe(false, false, -1)
	}
	if len(*sent) != 0 {
		t.Fatalf("stopped server alerted: %v", events(*sent))
	}
}

func TestProxyDownIsGroupedAndRecovers(t *testing.T) {
	s, _, sent := newTestService(t, "en", nil)
	check := func(a, b bool) {
		s.ObserveProxies("srv", "home", []ProxyState{{ID: "1", Name: "web", Online: a}, {ID: "2", Name: "ssh", Online: b}})
	}

	check(true, true)
	for range failThreshold {
		check(false, false)
	}
	check(false, false)
	check(true, false)
	if got := strings.Join(events(*sent), ","); got != "proxy_down,proxy_recovered" {
		t.Fatalf("events = %s", got)
	}
	if body := (*sent)[0].Body; !strings.Contains(body, "ssh, web") || !strings.Contains(body, "15 seconds") {
		t.Errorf("down message = %q", body)
	}
	if body := (*sent)[1].Body; !strings.Contains(body, "web") || strings.Contains(body, "ssh") {
		t.Errorf("recovered message = %q", body)
	}

	// Stopping the server forgets ssh's alert, so starting again reports nothing stale.
	*sent = nil
	s.ServerStopped("srv")
	check(true, true)
	if len(*sent) != 0 {
		t.Fatalf("messages after restart: %v", events(*sent))
	}
}

func TestDisabledNotificationsAndEvents(t *testing.T) {
	s, _, sent := newTestService(t, "en", func(s *Settings) { s.Events.ProxyDown = false })
	for range failThreshold {
		s.ObserveProxies("srv", "home", []ProxyState{{ID: "1", Name: "web"}})
	}
	s.FrpcExited("srv", "home", errors.New("login failed"))
	if got := strings.Join(events(*sent), ","); got != "frpc_exited" {
		t.Fatalf("events = %s", got)
	}
	if !strings.Contains((*sent)[0].Body, "login failed") {
		t.Errorf("exit message = %q", (*sent)[0].Body)
	}

	settings, _ := s.GetSettings()
	settings.Enabled = false
	if err := s.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	*sent = nil
	s.FrpcExited("srv", "home", nil)
	if len(*sent) != 0 {
		t.Fatalf("sent while disabled: %v", events(*sent))
	}
}

func TestChannelPayloads(t *testing.T) {
	var mu sync.Mutex
	got := map[string]map[string]any{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var v map[string]any
		_ = json.Unmarshal(body, &v)
		mu.Lock()
		got[r.URL.Path] = v
		mu.Unlock()
		switch r.URL.Path {
		case "/wecom-error":
			_, _ = w.Write([]byte(`{"errcode":93000,"errmsg":"invalid webhook url"}`))
		case "/botSECRET/sendMessage":
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			_, _ = w.Write([]byte(`{"errcode":0}`))
		}
	}))
	defer srv.Close()

	s, _, _ := newTestService(t, "en", nil)
	settings := Settings{
		Webhook:  WebhookChannel{Enabled: true, URL: srv.URL + "/feishu", Format: FormatFeishu},
		Telegram: TelegramChannel{Enabled: true, BotToken: "SECRET", ChatID: "42", APIBase: srv.URL},
		Bark:     BarkChannel{Enabled: true, ServerURL: srv.URL, DeviceKey: "dev"},
	}
	results, err := s.SendTest(settings)
	if err != nil {
		t.Fatal(err)
	}
	for channel, err := range results {
		if err != nil {
			t.Errorf("%s: %v", channel, err)
		}
	}
	if c, _ := got["/feishu"]["content"].(map[string]any); !strings.Contains(c["text"].(string), "Test notification") {
		t.Errorf("feishu payload = %v", got["/feishu"])
	}
	if got["/botSECRET/sendMessage"]["chat_id"] != "42" {
		t.Errorf("telegram payload = %v", got["/botSECRET/sendMessage"])
	}
	if got["/push"]["device_key"] != "dev" || got["/push"]["group"] != "Podux" {
		t.Errorf("bark payload = %v", got["/push"])
	}

	// Bot APIs report failures with HTTP 200 and an error code.
	results, _ = s.SendTest(Settings{Webhook: WebhookChannel{Enabled: true, URL: srv.URL + "/wecom-error", Format: FormatWeCom}})
	if err := results["webhook"]; err == nil || !strings.Contains(err.Error(), "93000") {
		t.Errorf("wecom error = %v", err)
	}

	// A Telegram transport error must not leak the bot token.
	results, _ = s.SendTest(Settings{Telegram: TelegramChannel{Enabled: true, BotToken: "SECRET", ChatID: "1", APIBase: "http://127.0.0.1:1"}})
	if err := results["telegram"]; err == nil || strings.Contains(err.Error(), "SECRET") {
		t.Errorf("telegram error = %v", err)
	}
}

func TestSettingsValidation(t *testing.T) {
	bad := []Settings{
		{Webhook: WebhookChannel{Enabled: true, URL: "ftp://x"}},
		{Webhook: WebhookChannel{Enabled: true, URL: "https://x", Format: "slack"}},
		{Telegram: TelegramChannel{Enabled: true, BotToken: "t"}},
		{Bark: BarkChannel{Enabled: true}},
		{Email: EmailChannel{Enabled: true, To: "not an address"}},
		{LatencyThresholdMs: -1},
	}
	for i, s := range bad {
		if s.Validate() == nil {
			t.Errorf("case %d: invalid settings accepted: %+v", i, s)
		}
	}
	// Disabled channels are not checked.
	if err := (Settings{Webhook: WebhookChannel{URL: "nonsense"}}).Validate(); err != nil {
		t.Errorf("disabled channel validated: %v", err)
	}
}
