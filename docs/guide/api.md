# API 与 Prometheus 指标

Podux 可以创建 API Key，供脚本、Home Assistant、Grafana 或 Prometheus 访问。在 **设置** → **API** 中管理。

## 创建 API Key

填写名称、选择权限后点 **创建 Key**。Key 以 `pdx_` 开头，**只在创建时显示一次**：Podux 只保存它的 SHA-256 哈希，之后无法再查看，丢失了就删掉重建。列表中显示 Key 的开头几位和最近使用时间，便于辨认。

删除 Key 后，使用它的请求会立即被拒绝。

| 权限 | 可以做什么 |
| --- | --- |
| 只读 | 读取指标、仪表盘统计和代理状态 |
| 读写 | 在只读的基础上，启动、停止、重载 frpc，批量启用、停用、删除或迁移代理 |

## 调用接口

在请求头中携带 Key：

```bash
curl -H "Authorization: Bearer pdx_xxxxxxxx" http://<Podux 地址>:8090/api/metrics
```

API Key 只能访问下面这些接口：

| 接口 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/metrics` | 只读 | Prometheus 文本格式的指标，见下文 |
| `GET /api/dashboard/stats` | 只读 | 仪表盘统计：服务器、代理、访问端数量，最高延迟，今日流量 |
| `GET /api/proxies/status` | 只读 | 每个代理的流量和外网可达性；可加 `?serverId=` 只看一台服务器 |
| `POST /api/frpc/launch` | 读写 | 启动服务器的 frpc，请求体 `{"id": "<服务器 ID>"}` |
| `POST /api/frpc/terminate` | 读写 | 停止服务器的 frpc，请求体同上 |
| `POST /api/frpc/reload` | 读写 | 重载服务器的配置，请求体同上 |
| `POST /api/proxies/batch` | 读写 | 批量操作代理，请求体 `{"ids": [...], "action": "enable"}`，`action` 可选 `enable`、`disable`、`delete`、`move`（迁移时加 `"serverId"`） |

只读 Key 调用读写接口会返回 `403`。

::: warning 安全边界
API Key 不是登录身份。它不能登录界面，不能访问 PocketBase 的集合接口，也不能管理 API Key、读写设置、备份和恢复，因此拿不到 frps token、通知渠道密钥等敏感配置。即便如此，读写 Key 仍可以停止隧道和删除代理，请像密码一样保管；只用来抓取指标时，创建只读 Key。

Podux 本身是 HTTP 服务，Key 在请求头中明文传输。从其他机器访问时，请放在 HTTPS 反向代理之后，或者只在内网中使用。
:::

## Prometheus

在 Prometheus 配置中添加一个抓取任务，`credentials` 换成一个只读 Key：

```yaml
scrape_configs:
  - job_name: podux
    metrics_path: /api/metrics
    scheme: http
    authorization:
      credentials: pdx_xxxxxxxx
    static_configs:
      - targets: ["192.168.1.10:8090"]
```

**设置** → **API** 页面底部有按当前访问地址生成的配置，可以直接复制。

### 指标

所有指标都是 gauge。服务器指标带 `server_id`、`server` 标签；代理指标带 `proxy_id`、`proxy`、`type`、`server_id`、`server` 标签。

| 指标 | 说明 |
| --- | --- |
| `podux_info{version}` | Podux 版本，值恒为 1 |
| `podux_server_running` | 服务器的 frpc 是否在运行（1/0） |
| `podux_server_reachable` | 最近一次延迟探测是否连上 frps |
| `podux_server_latency_milliseconds` | 最近一次成功探测的延迟 |
| `podux_proxy_enabled` | 代理是否已启用 |
| `podux_proxy_online` | frpc 是否报告代理已启动 |
| `podux_proxy_reachable` | 最近一次外网探测是否连上代理，见[外网可达性探测](/guide/traffic#外网可达性探测) |

服务器配置了 [frps 管理面板](/guide/traffic) 时，还有以下指标。今日流量由 frps 统计，每天清零：

| 指标 | 说明 |
| --- | --- |
| `podux_server_frps_connections` | frps 当前连接数 |
| `podux_server_frps_clients` | 连接到 frps 的客户端数 |
| `podux_server_today_traffic_in_bytes` / `..._out_bytes` | frps 今日入站 / 出站流量 |
| `podux_proxy_connections` | 代理当前连接数 |
| `podux_proxy_today_traffic_in_bytes` / `..._out_bytes` | 代理今日入站 / 出站流量 |

还没有数据的指标不会输出，例如刚启动、还没探测过时没有 `podux_proxy_reachable`。

frps 管理面板的数据会缓存 15 秒，抓取间隔设为 15 秒或更长即可。

### 告警示例

```yaml
groups:
  - name: podux
    rules:
      - alert: PoduxProxyOffline
        expr: podux_proxy_enabled == 1 and podux_proxy_online == 0
        for: 2m
        annotations:
          summary: "代理 {{ $labels.proxy }}（{{ $labels.server }}）已离线"
```

Podux 自带的[告警通知](/guide/notifications)已经覆盖常见情况；用 Prometheus 时，可以把告警统一放到 Alertmanager 里。
