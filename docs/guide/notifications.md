# 告警通知

Podux 可以在服务器或代理出现异常时发送通知，恢复正常后再通知一次。在 **设置** → **通知** 中配置。

## 触发条件

告警只针对**正在运行**的服务器。为了避免网络抖动和配置重载造成误报，都需要异常持续一段时间：

| 事件 | 触发条件 |
| --- | --- |
| 服务器不可达 | 连续 3 次延迟探测都连不上 frps |
| 延迟过高 | 连续 3 次探测延迟超过设定的阈值（阈值为 0 时不检查） |
| 代理掉线 | 已启用的代理离线超过 15 秒；同一服务器上同时掉线的多个代理合并成一条消息 |
| 代理外网不可达 | 代理在 frpc 中在线，但从外部连续 3 次探测（约 3 分钟）都连不上，见[流量与可达性](/guide/traffic#外网可达性探测) |
| frpc 意外退出 | frpc 不是由你停止而退出，例如启动时第一次登录 frps 失败 |
| 临时代理到期 | 设置了[有效期](/guide/proxy-options#有效期)的代理到期并被自动停用 |
| 恢复通知 | 上述问题恢复正常时再发送一条 |

延迟探测的间隔在 **设置** → **常规** 中修改（10–300 秒），"服务器不可达"和"延迟过高"的反应时间约为 3 个探测间隔。

每个问题只通知一次，直到恢复。手动停止服务器不会触发告警。

通知内容的语言跟随安装时选择的默认语言。

## 通知渠道

可以同时开启多个渠道。修改后可以先点 **发送测试**，确认各渠道都能收到，再保存。

### Webhook

向指定地址发送 POST 请求，支持四种格式：

| 格式 | 说明 |
| --- | --- |
| 通用 JSON | `{"event", "title", "message", "serverId", "serverName", "time"}`，适合自己写脚本或接入 Home Assistant、n8n 等 |
| 企业微信机器人 | 填写群机器人的 Webhook 地址 |
| 钉钉机器人 | 填写自定义机器人的 Webhook 地址；安全设置请选择"自定义关键词"，关键词填 `Podux` |
| 飞书机器人 | 填写自定义机器人的 Webhook 地址 |

通用 JSON 的 `event` 取值：`server_unreachable`、`server_recovered`、`high_latency`、`latency_recovered`、`proxy_down`、`proxy_recovered`、`proxy_unreachable`、`proxy_reachable`、`proxy_expired`、`frpc_exited`、`test`。

### Telegram

填写 Bot Token（向 [@BotFather](https://t.me/BotFather) 创建机器人获得）和 Chat ID。如果运行 Podux 的机器无法直连 `api.telegram.org`，可以在 **API 地址** 中填写反向代理或自建 Bot API 的地址。

### Bark

填写 Bark App 中的 Device Key。使用自建 Bark 服务端时修改 **服务器地址**，默认为 `https://api.day.app`。

### 邮件

使用 PocketBase 的发件设置。先在 PocketBase 管理后台（`/_/`）的 **Settings → Mail settings** 中配置发件人地址和 SMTP 服务器，再在 Podux 中填写收件人（多个地址用逗号分隔）。

::: warning
通知设置中的 Bot Token 等信息保存在数据目录的数据库里，请参考[数据与备份](/deploy/backup)保护好数据目录。
:::
