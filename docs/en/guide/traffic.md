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

An "online" proxy in frpc only means the tunnel is up; it doesn't guarantee it can be reached from outside (a firewall on the frps host may block the port, or the domain may not resolve). Every minute, **from the Podux host**, Podux probes the online proxies of running servers:

| Proxy type | Probe |
| --- | --- |
| TCP | Connect to `server address:remote port` |
| HTTP | Request frps's HTTP port with the proxy's domain and first location. frps's own 404 page (no matching proxy) or 502/503/504 count as failures; any other status from the service, including 401 and 404, counts as reachable |
| HTTPS | TLS handshake with frps's HTTPS port using the proxy's domain |

UDP, STCP, SUDP, XTCP and TCPMUX proxies are not probed, nor are proxies with remote port 0 (chosen by frps) or only wildcard domains.

HTTP/HTTPS probes use frps's vhost ports and `subdomainHost`: read from frps when a dashboard is configured, otherwise 80 and 443, and subdomain-only proxies are skipped.

Results show in the "Reachability / traffic" column. With the "Proxy unreachable from outside" [alert](/en/guide/notifications) on, 3 failed probes in a row (about 3 minutes) send an alert, and another when it recovers.

::: tip
Probes go out from the Podux host. If it shares a LAN with frps, or your router doesn't support reaching its own public address (hairpin NAT), results can differ from real outside access.
:::
