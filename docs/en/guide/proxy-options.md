# Proxy Options

Besides addresses and ports, the proxy form offers the following, depending on the proxy type.

## HTTP Settings

HTTP proxies only (sign-in and routing by user also apply to TCPMUX):

| Setting | Effect |
| --- | --- |
| Username / password | Visitors must sign in before reaching the domain (HTTP Basic auth) |
| Route by HTTP user | Only take requests with this username, so several proxies can share a domain and split by signed-in user |
| Rewrite Host | Replaces the Host header sent to the local service, for services that route by host name (e.g. Nginx virtual hosts) |
| Locations | Only forward requests under these path prefixes, such as `/api`; one domain can be split across proxies by path |
| Request / response headers | Extra headers set when forwarding |

## TCPMUX

TCPMUX lets several TCP services share one frps port, told apart by domain, with clients connecting through an HTTP CONNECT proxy. frps needs `tcpmuxHTTPConnectPort`:

```toml
# frps.toml
tcpmuxHTTPConnectPort = 5002
```

In Podux, choose the TCPMUX type and enter the local address and a custom domain (or subdomain). A client connects like this:

```bash
ssh -o 'ProxyCommand nc -X connect -x frps.example.com:5002 %h %p' user@ssh.example.com
```

## Load Balancing

TCP, HTTP and TCPMUX proxies can set a **group** and **group key**. Proxies with the same group and key, possibly on different machines or Podux instances, share one remote port or domain, and frps spreads connections across them. With [health checks](#health-checks), a failing member drops out automatically for failover.

Proxies of one group may use the same port or domain without tripping the conflict check.

## Health Checks

frpc checks the local service periodically (TCP connect or HTTP request), takes the proxy offline after the set number of failures and brings it back when it recovers. Not available with a plugin (the plugin replaces the local service).

## Plugins

With a plugin, frpc handles connections itself instead of forwarding them to the local address and port:

| Plugin | Proxy types | Effect |
| --- | --- | --- |
| SOCKS5 | TCP, STCP, XTCP, TCPMUX | A SOCKS5 proxy server for reaching the LAN |
| HTTP Proxy | TCP, STCP, XTCP, TCPMUX | An HTTP proxy server for reaching the LAN |
| Static File | TCP, HTTP, STCP, XTCP | Publishes a local directory as a download site |
| Unix Socket | TCP, STCP, XTCP, TCPMUX | Publishes a local Unix socket (e.g. `/var/run/docker.sock`) |
| HTTP2HTTP | HTTP, TCP | Forwards to another local HTTP address, optionally rewriting Host and headers |
| HTTP2HTTPS | HTTP, TCP | Takes HTTP and forwards it to a local HTTPS service |
| HTTPS2HTTP | HTTPS, TCP | Terminates HTTPS here with a certificate and forwards HTTP to the local service |
| HTTPS2HTTPS | HTTPS, TCP | Terminates HTTPS here and forwards HTTPS |
| TLS2Raw | HTTPS, TCP | Terminates TLS here and forwards plain TCP |

For HTTPS2HTTP, HTTPS2HTTPS and TLS2Raw you can **paste the PEM certificate and key**, which Podux writes to its data directory, or give file paths on the Podux host (mount them in Docker). Leave both empty for a self-signed certificate.

::: tip
Static File and Unix Socket read a directory or socket on **the Podux host**; with Docker, mount them into the container first.
:::

## Expiry

A proxy can disable itself after 1 hour, 2 hours, 6 hours, 1 day, 7 days, or at a set time. When it expires, the proxy is disabled and a "temporary proxy expired" alert is sent (if enabled, see [Alerts](/en/guide/notifications)). Handy for exposing SSH or remote desktop for a while.

The proxy list shows the time left under a temporary proxy's name. Enabling an expired proxy again does not disable it again right away.

## Batch Actions and Cloning

Tick proxies in the proxy list (current page) to **enable, disable, move to another server or delete** them together. A batch either fully succeeds or changes nothing: if enabling one of them would conflict with another proxy's port, the message names both.

The **Clone** button opens a new-proxy form filled from that proxy; the remote port and domains are cleared so the copy doesn't collide with the original.

## Conflict Checks

When you save or enable a proxy, Podux checks the enabled proxies of the same server:

- TCP proxies can't share a remote port, nor can UDP proxies
- HTTP, HTTPS and TCPMUX proxies can't share a subdomain or custom domain

These are allowed, as frps allows them: the same load balancing group; routing by different users; HTTP proxies whose locations don't overlap.
