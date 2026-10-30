# Compatibility

| Item | Details |
| --- | --- |
| Embedded frpc | v0.71.1 |
| frps version | frp officially guarantees frpc v0.71 works with frps **v0.63 – v0.79**. Older frps usually connects too (v0.61 tested), but is outside the official guarantee. In mixed deployments, upgrade frps first |
| Proxy types | TCP, UDP, HTTP, HTTPS, STCP, SUDP, XTCP |
| Visitors | STCP, SUDP, XTCP; see [STCP/XTCP and Visitors](/en/guide/secret-proxies) |
| Authentication | token, OIDC |
| Transports | tcp, kcp, quic, websocket, wss, with optional TLS |
| Platforms | Linux (amd64 / arm64 / armv7), macOS (amd64 / arm64), Windows (amd64) |
| Docker image architectures | `linux/amd64`, `linux/arm64`, `linux/arm/v7` |

## Not Supported Yet

- **Proxy types**: TCPMUX is not supported. When an imported TOML config contains such proxies, they are skipped with a warning.
- **Proxy plugins**: only the SOCKS5 plugin on TCP proxies is supported.
- **Load balancing**: proxy `loadBalancer` groups are not supported; health checks work on their own.
- **XTCP fallback**: visitors don't support `fallbackTo`, so a failed peer-to-peer connection does not fall back to STCP.

Podux does not swap its embedded frpc on its own; the frpc version changes with Podux releases, see each [release's notes](https://github.com/Derrors/podux/releases).
