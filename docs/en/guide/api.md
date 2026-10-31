# API and Prometheus Metrics

Podux can create API keys for scripts, Home Assistant, Grafana or Prometheus. Manage them under **Settings** → **API**.

## Creating an API Key

Enter a name, pick the access level and click **Create key**. Keys start with `pdx_` and are **shown only once**: Podux stores just their SHA-256 hash, so a lost key cannot be recovered; delete it and create a new one. The list shows the first characters of each key and when it was last used, so you can tell them apart.

Deleting a key rejects its requests immediately.

| Access | What it allows |
| --- | --- |
| Read-only | Reading metrics, dashboard stats and proxy status |
| Read and write | All of the above, plus starting, stopping and reloading frpc, and enabling, disabling, deleting or moving proxies in batches |

## Calling the API

Send the key in the request header:

```bash
curl -H "Authorization: Bearer pdx_xxxxxxxx" http://<Podux address>:8090/api/metrics
```

API keys only work on these endpoints:

| Endpoint | Access | Description |
| --- | --- | --- |
| `GET /api/metrics` | Read-only | Metrics in the Prometheus text format, see below |
| `GET /api/dashboard/stats` | Read-only | Dashboard stats: server, proxy and visitor counts, highest latency, today's traffic |
| `GET /api/proxies/status` | Read-only | Traffic and external reachability per proxy; add `?serverId=` for a single server |
| `POST /api/frpc/launch` | Read and write | Starts a server's frpc; body `{"id": "<server ID>"}` |
| `POST /api/frpc/terminate` | Read and write | Stops a server's frpc; same body |
| `POST /api/frpc/reload` | Read and write | Reloads a server's configuration; same body |
| `POST /api/proxies/batch` | Read and write | Batch actions on proxies; body `{"ids": [...], "action": "enable"}` with `action` one of `enable`, `disable`, `delete`, `move` (add `"serverId"` to move) |

A read-only key gets `403` from the read-and-write endpoints.

::: warning Security boundary
An API key is not a user session. It cannot sign in to the UI, reach the PocketBase collection API, manage API keys, change settings, or create or restore backups, so it cannot read sensitive settings such as frps tokens or notification credentials. Even so, a read-and-write key can stop tunnels and delete proxies: keep it like a password, and create a read-only key for scraping metrics.

Podux itself serves plain HTTP, so keys travel in clear text. When calling it from other machines, put it behind an HTTPS reverse proxy or keep it on your local network.
:::

## Prometheus

Add a scrape job to the Prometheus configuration, with a read-only key as `credentials`:

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

The bottom of **Settings** → **API** shows this configuration for the address you are using, ready to copy.

### Metrics

All metrics are gauges. Server metrics have `server_id` and `server` labels; proxy metrics have `proxy_id`, `proxy`, `type`, `server_id` and `server`.

| Metric | Description |
| --- | --- |
| `podux_info{version}` | Podux version; always 1 |
| `podux_server_running` | Whether frpc is running for the server (1/0) |
| `podux_server_reachable` | Whether the last latency probe reached frps |
| `podux_server_latency_milliseconds` | Latency of the last successful probe |
| `podux_proxy_enabled` | Whether the proxy is enabled |
| `podux_proxy_online` | Whether frpc reports the proxy as started |
| `podux_proxy_reachable` | Whether the last external probe reached the proxy, see [external reachability probes](/en/guide/traffic#external-reachability-probes) |

Servers with an [frps dashboard](/en/guide/traffic) configured also have these. frps counts today's traffic and resets it daily:

| Metric | Description |
| --- | --- |
| `podux_server_frps_connections` | Current connections on frps |
| `podux_server_frps_clients` | Clients connected to frps |
| `podux_server_today_traffic_in_bytes` / `..._out_bytes` | Traffic into / out of frps today |
| `podux_proxy_connections` | Current connections to the proxy |
| `podux_proxy_today_traffic_in_bytes` / `..._out_bytes` | Traffic into / out of the proxy today |

Metrics without data yet are left out; for example, there is no `podux_proxy_reachable` until the first probe.

frps dashboard data is cached for 15 seconds, so a scrape interval of 15 seconds or more is enough.

### Alert Example

```yaml
groups:
  - name: podux
    rules:
      - alert: PoduxProxyOffline
        expr: podux_proxy_enabled == 1 and podux_proxy_online == 0
        for: 2m
        annotations:
          summary: "Proxy {{ $labels.proxy }} on {{ $labels.server }} is offline"
```

Podux's own [alerts](/en/guide/notifications) already cover the common cases; with Prometheus, you can keep all alerting in Alertmanager instead.
