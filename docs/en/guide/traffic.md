# Traffic and Reachability

## Traffic Stats

frpc doesn't count traffic per proxy, so Podux reads it from the **frps dashboard** (webServer). First enable the dashboard on frps:

```toml
# frps.toml
webServer.addr = "0.0.0.0"
webServer.port = 7500
webServer.user = "admin"
webServer.password = "a strong password"
```

Then, in the Podux server settings, enter the **frps dashboard** address (e.g. `http://frps.example.com:7500`), username and password, and click **Test connection**. You then get:

- The "Reachability / traffic" column of the proxy list and server detail: each proxy's traffic in and out today and current connections; click for a 7-day chart
- "frps status" on the server detail page: frps version, total traffic today, connections and clients online
- "Traffic today" on the dashboard: the sum over servers with a dashboard

frps keeps the traffic counts in memory, so they reset when frps restarts. Podux queries each frps at most once every 15 seconds.

::: warning
The dashboard password is stored in Podux's database. If the dashboard is reachable from the internet, use a strong password or only allow the Podux host.
:::

## External Reachability Probes

An "online" proxy in frpc only means the tunnel is up; it doesn't guarantee it can be reached from outside (a firewall on the frps host may block the port, or the domain may not resolve). With a target cycle of 1 minute, **from the Podux host**, Podux probes the online proxies of running servers:

| Proxy type | Probe |
| --- | --- |
| TCP | Connect to `server address:remote port` |
| HTTP | Request frps's HTTP port with the proxy's domain and first location. frps's own 404 page (no matching proxy) or 502/503/504 count as failures; any other status from the service, including 401 and 404, counts as reachable |
| HTTPS | TLS handshake with frps's HTTPS port using the proxy's domain |

UDP, STCP, SUDP, XTCP and TCPMUX proxies are not probed, nor are proxies with remote port 0 (chosen by frps) or only wildcard domains.

TCP, HTTP and HTTPS proxy forms have an **External reachability probe** switch under **Network Config**. It is on by default, including for existing proxies without this setting, and can be turned off per proxy. Turning it off only stops Podux's independent external probes; it does not disable the proxy, change tunnel settings or affect frpc's [local service health checks](/en/guide/proxy-options#health-checks).

When off, the "Reachability / traffic" column in the proxy list and server detail shows a gray "Probe disabled" badge instead of old reachable or unreachable results. With an frps dashboard configured, traffic stats, current connections and click-to-view 7-day traffic history remain available. Editing and cloning preserve the setting; switching to an unsupported proxy type hides the switch without overwriting its value.

HTTP/HTTPS probes use frps's vhost ports and `subdomainHost`: read from frps when a dashboard is configured, otherwise 80 and 443, and subdomain-only proxies are skipped.

If frps sits behind an HTTPS reverse proxy (for example nginx terminating TLS on 443) and its vhost ports are not reachable from outside, turn on **Probe through public HTTPS** in the server's frps dashboard section. HTTP and HTTPS proxies are then probed on their domain's port 443 the way users reach them; the certificate is not checked. Subdomain proxies still need the dashboard for `subdomainHost`.

Within each round, servers are probed in parallel, with probe starts staggered and rate-limited separately for each server record: at most 4 concurrent probes and at least `max(250ms, 1min / N)` between starts (`N` is that server's target count for the current round). This spreads short-lived connection bursts. The next round waits for all servers to finish, so many or slow targets can delay its start; rounds never overlap and missed rounds are not replayed to catch up. This only reduces bursts and does not guarantee elimination of FRP connection-pool-full errors.

Each completed probe immediately updates its reachability result, shown in the "Reachability / traffic" column; alerts are evaluated after each server's complete round. With the "Proxy unreachable from outside" [alert](/en/guide/notifications) on, a proxy failing probes in 3 consecutive complete rounds triggers an alert, and another when it recovers. This usually takes about 3 minutes, but depends on round completion and takes longer with many or slow targets.

Stopping the service cancels queued and in-flight probes and waits for them to exit; these cancellations are not recorded as failures and do not cause false unreachable alerts.

::: tip
Probes go out from the Podux host. If it shares a LAN with frps, or your router doesn't support reaching its own public address (hairpin NAT), results can differ from real outside access.
:::
