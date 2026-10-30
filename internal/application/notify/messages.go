package notify

import (
	"fmt"
	"strings"
	"time"
)

// Event names, also sent as "event" in generic webhook payloads.
const (
	EventServerUnreachable = "server_unreachable"
	EventServerRecovered   = "server_recovered"
	EventHighLatency       = "high_latency"
	EventLatencyRecovered  = "latency_recovered"
	EventProxyDown         = "proxy_down"
	EventProxyRecovered    = "proxy_recovered"
	EventFrpcExited        = "frpc_exited"
	EventTest              = "test"
)

// Message is one notification, already rendered in the system language.
type Message struct {
	Event      string    `json:"event"`
	Title      string    `json:"title"`
	Body       string    `json:"message"`
	ServerID   string    `json:"serverId,omitempty"`
	ServerName string    `json:"serverName,omitempty"`
	Time       time.Time `json:"time"`
}

// Text is the title and body as one plain-text block, for channels without a title.
func (m Message) Text() string {
	return m.Title + "\n" + m.Body
}

type texts struct{ title, body string }

// templates maps language -> event -> title/body. Titles get the server name appended;
// bodies are fmt templates whose arguments are documented per event.
var templates = map[string]map[string]texts{
	"zh": {
		EventServerUnreachable: {"服务器不可达", "连续 %d 次探测都无法连接到 frps（%s）。"},                 // count, addr
		EventServerRecovered:   {"服务器已恢复", "frps（%s）可以重新连接，当前延迟 %d ms。"},                // addr, latency
		EventHighLatency:       {"延迟过高", "连续 %d 次探测延迟超过 %d ms，最近一次为 %d ms。"},            // count, threshold, latency
		EventLatencyRecovered:  {"延迟已恢复", "延迟已回落到 %d ms（阈值 %d ms）。"},                    // latency, threshold
		EventProxyDown:         {"代理掉线", "以下代理已离线超过 %d 秒：%s"},                           // seconds, names
		EventProxyRecovered:    {"代理已恢复", "以下代理已重新上线：%s"},                               // names
		EventFrpcExited:        {"frpc 意外退出", "该服务器的 frpc 已退出：%s。请在 Podux 中查看日志后重新启动。"}, // error
		EventTest:              {"测试通知", "如果你收到这条消息，说明通知渠道配置正确。"},
	},
	"en": {
		EventServerUnreachable: {"Server unreachable", "frps (%[2]s) could not be reached in %[1]d consecutive probes."},
		EventServerRecovered:   {"Server recovered", "frps (%s) is reachable again; latency is now %d ms."},
		EventHighLatency:       {"High latency", "Latency exceeded %[2]d ms in %[1]d consecutive probes; the latest was %[3]d ms."},
		EventLatencyRecovered:  {"Latency recovered", "Latency is back to %d ms (threshold %d ms)."},
		EventProxyDown:         {"Proxies offline", "These proxies have been offline for over %d seconds: %s"},
		EventProxyRecovered:    {"Proxies recovered", "These proxies are back online: %s"},
		EventFrpcExited:        {"frpc exited", "frpc for this server exited: %s. Check its log in Podux and start it again."},
		EventTest:              {"Test notification", "If you received this, the notification channel works."},
	},
}

func render(lang, event, serverID, serverName string, args ...any) Message {
	set, ok := templates[lang]
	if !ok {
		set = templates["en"]
	}
	t := set[event]
	title := "[Podux] " + t.title
	if serverName != "" {
		title += ": " + serverName
	}
	return Message{
		Event:      event,
		Title:      title,
		Body:       fmt.Sprintf(t.body, args...),
		ServerID:   serverID,
		ServerName: serverName,
		Time:       time.Now(),
	}
}

func joinNames(names []string) string {
	return strings.Join(names, ", ")
}
