# Compatibility

| Item | Details |
| --- | --- |
| Embedded frpc | v0.71.1 |
| frps version | frp officially guarantees frpc v0.71 works with frps **v0.63 – v0.79**. Older frps usually connects too (v0.61 tested), but is outside the official guarantee. In mixed deployments, upgrade frps first |
| Proxy types | TCP, UDP, HTTP, HTTPS, STCP, SUDP, XTCP, TCPMUX |
| Proxy plugins | SOCKS5, HTTP Proxy, Static File, Unix Socket, HTTP2HTTP, HTTP2HTTPS, HTTPS2HTTP, HTTPS2HTTPS, TLS2Raw; see [Proxy Options](/en/guide/proxy-options#plugins) |
| Traffic stats | Needs the frps dashboard (webServer); see [Traffic and Reachability](/en/guide/traffic) |
| Visitors | STCP, SUDP, XTCP; see [STCP/XTCP and Visitors](/en/guide/secret-proxies) |
| Authentication | token, OIDC |
| Transports | tcp, kcp, quic, websocket, wss, with optional TLS |
| Platforms | Linux (amd64 / arm64 / armv7), macOS (amd64 / arm64), Windows (amd64) |
| Docker image architectures | `linux/amd64`, `linux/arm64`, `linux/arm/v7` |

## Not Supported Yet

- **VirtualNet plugin**: an experimental frp feature, not supported.
- **Visitor plugins**: frp's visitor plugins are not supported.

Podux does not swap its embedded frpc on its own; the frpc version changes with Podux releases, see each [release's notes](https://github.com/Derrors/podux/releases).
