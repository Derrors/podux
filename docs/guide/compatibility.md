# 兼容性

| 项目 | 说明 |
| --- | --- |
| 内嵌 frpc 版本 | v0.71.1 |
| frps 版本 | frp 官方保证 frpc v0.71 与 frps **v0.63 – v0.79** 兼容；更旧的 frps 通常也能连接（v0.61 实测可用），但不在官方保证范围内。混合版本部署时建议先升级 frps |
| 代理类型 | TCP、UDP、HTTP、HTTPS |
| 认证方式 | token、OIDC |
| 传输协议 | tcp、kcp、quic、websocket、wss，可配置 TLS |
| 运行平台 | Linux（amd64 / arm64 / armv7）、macOS（amd64 / arm64）、Windows（amd64） |
| Docker 镜像架构 | `linux/amd64`、`linux/arm64`、`linux/arm/v7` |

## 暂不支持的功能

- **代理类型**：STCP、SUDP、XTCP、TCPMUX 暂不支持。导入的 TOML 配置中包含这些类型时，会跳过对应代理并给出提示。
- **访问端（visitor）**：暂不支持配置 STCP/XTCP 的访问端。
- **代理插件**：目前只支持 TCP 代理的 SOCKS5 插件。

Podux 不会自动替换内嵌的 frpc 版本；frpc 的版本随 Podux 版本更新，见各版本的 [Release 说明](https://github.com/Derrors/podux/releases)。
