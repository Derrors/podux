# 兼容性

| 项目 | 说明 |
| --- | --- |
| 内嵌 frpc 版本 | v0.71.1 |
| frps 版本 | frp 官方保证 frpc v0.71 与 frps **v0.63 – v0.79** 兼容；更旧的 frps 通常也能连接（v0.61 实测可用），但不在官方保证范围内。混合版本部署时建议先升级 frps |
| 代理类型 | TCP、UDP、HTTP、HTTPS、STCP、SUDP、XTCP、TCPMUX |
| 代理插件 | SOCKS5、HTTP Proxy、Static File、Unix Socket、HTTP2HTTP、HTTP2HTTPS、HTTPS2HTTP、HTTPS2HTTPS、TLS2Raw，见[代理进阶设置](/guide/proxy-options#插件) |
| 流量统计 | 需要 frps 开启管理面板（webServer），见[流量与可达性](/guide/traffic) |
| 访问端（visitor） | STCP、SUDP、XTCP，见 [STCP/XTCP 与访问端](/guide/secret-proxies) |
| 认证方式 | token、OIDC |
| 传输协议 | tcp、kcp、quic、websocket、wss，可配置 TLS |
| 运行平台 | Linux（amd64 / arm64 / armv7）、macOS（amd64 / arm64）、Windows（amd64） |
| Docker 镜像架构 | `linux/amd64`、`linux/arm64`、`linux/arm/v7` |

## 暂不支持的功能

- **VirtualNet 插件**：frp 的实验性功能，暂不支持。
- **访问端插件**：访问端暂不支持 frp 的 visitor 插件。

Podux 不会自动替换内嵌的 frpc 版本；frpc 的版本随 Podux 版本更新，见各版本的 [Release 说明](https://github.com/Derrors/podux/releases)。
