# Alerts

Podux can notify you when a server or proxy has a problem, and again when it recovers. Configure it under **Settings** → **Notifications**.

## Triggers

Alerts cover **running** servers only. To avoid false alarms from network blips and config reloads, a problem must last for a while:

| Event | Trigger |
| --- | --- |
| Server unreachable | frps fails 3 latency probes in a row |
| High latency | Latency exceeds the threshold in 3 probes in a row (a threshold of 0 turns this off) |
| Proxies offline | An enabled proxy is offline for over 15 seconds; proxies of one server that go down together share one message |
| frpc exited | frpc stops without you stopping it, e.g. its first login to frps failed at startup |
| Recovery | One more message when a problem above clears |

The latency probe interval is set under **Settings** → **General** (10–300 seconds); "Server unreachable" and "High latency" react after about 3 probe intervals.

Each problem is reported once until it clears. Stopping a server yourself never alerts.

Messages use the default language chosen during setup.

## Channels

Several channels can be on at once. After a change, click **Send test** to check that every channel receives it, then save.

### Webhook

Sends a POST request to a URL, in one of four formats:

| Format | Description |
| --- | --- |
| Generic JSON | `{"event", "title", "message", "serverId", "serverName", "time"}`, for your own scripts or Home Assistant, n8n and similar |
| WeCom bot | The group bot's webhook URL |
| DingTalk bot | The custom bot's webhook URL; under security settings choose "custom keywords" with the keyword `Podux` |
| Feishu / Lark bot | The custom bot's webhook URL |

`event` values in generic JSON: `server_unreachable`, `server_recovered`, `high_latency`, `latency_recovered`, `proxy_down`, `proxy_recovered`, `frpc_exited`, `test`.

### Telegram

Enter the bot token (create a bot with [@BotFather](https://t.me/BotFather)) and the chat ID. If the Podux machine cannot reach `api.telegram.org`, set **API address** to a reverse proxy or a self-hosted Bot API.

### Bark

Enter the device key from the Bark app. For a self-hosted Bark server, change **Server**; it defaults to `https://api.day.app`.

### Email

Uses PocketBase's mail settings. First set the sender address and SMTP server under **Settings → Mail settings** in the PocketBase admin UI (`/_/`), then enter the recipients in Podux (comma separated).

::: warning
Bot tokens and other notification settings are stored in the database in the data directory; protect it as described in [Data and Backups](/en/deploy/backup).
:::
