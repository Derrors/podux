<a name="readme-top"></a>

<div align="right">
  <b>简体中文</b> | <a href="README_en.md">English</a>
</div>

<div align="center">
  <a href="https://github.com/Derrors/podux">
    <img src="site/src/assets/logo.png" alt="Logo" width="120">
  </a>

  <h3 align="center">Podux</h3>

  <p align="center">
    frpc 的 Web 管理面板：在一个界面里管理多台 frps 服务器、全部代理、连接状态和运行日志，不用再手动编辑配置文件。
  </p>

  <p align="center">
    <a href="https://github.com/Derrors/podux/releases/latest"><img src="https://img.shields.io/github/v/release/Derrors/podux?style=flat-square" alt="Release"></a>
    <a href="https://github.com/Derrors/podux/pkgs/container/podux"><img src="https://img.shields.io/badge/ghcr.io-derrors%2Fpodux-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker"></a>
    <a href="go.mod"><img src="https://img.shields.io/github/go-mod/go-version/Derrors/podux?style=flat-square" alt="Go"></a>
    <img src="https://img.shields.io/badge/frp-v0.71.1-blue?style=flat-square" alt="frp">
    <a href="LICENSE"><img src="https://img.shields.io/github/license/Derrors/podux?style=flat-square" alt="License"></a>
  </p>

  <p align="center">
    <a href="#快速开始"><strong>🚀 快速开始</strong></a>
    &nbsp;·&nbsp;
    <a href="#文档"><strong>📖 文档</strong></a>
    &nbsp;·&nbsp;
    <a href="https://github.com/Derrors/podux/releases">📦 版本发布</a>
    &nbsp;·&nbsp;
    <a href="https://github.com/Derrors/podux/issues">🐛 问题反馈</a>
  </p>
</div>

> [!NOTE]
> 本仓库是 [luckjiawei/podux](https://github.com/luckjiawei/podux) 的**独立维护分支**，从 v0.2.0 起独立迭代，不再与上游同步。版本、安装包与 Docker 镜像（`ghcr.io/derrors/podux`）均从这里发布，问题与建议请在本仓库提交。详见[与上游的关系](docs/guide/what-is-podux.md#与上游的关系)。

## 简介

[frp](https://github.com/fatedier/frp) 是常用的开源内网穿透工具，但原生 frpc 只能靠配置文件驱动：每次改动都要编辑 `.toml` 再重启，同时连多台 frps 时配置容易混乱，也看不到连接状态和延迟。

Podux 把 frpc 作为库内嵌在程序里，后端基于 [PocketBase](https://pocketbase.io/)（内置 SQLite），前端基于 React。整个应用打包成**一个可执行文件**，也提供多架构 Docker 镜像，部署后在浏览器里完成全部配置。

## 功能特性

- **多服务器**：同时连接多台 frps，每台对应一个独立的 frpc 实例；支持 token / OIDC 认证，tcp、kcp、quic、websocket、wss 传输与 TLS；可开机自动连接
- **代理管理**：可视化配置 TCP、UDP、HTTP、HTTPS 代理，支持子域名与自定义域名、加密压缩、SOCKS5 插件；修改后自动热重载，**只重启配置有变化的代理**
- **监控与日志**：仪表盘与拓扑图；定时探测延迟并保留历史曲线，显示服务器地理位置；frpc 日志实时推送
- **导入**：导入现有 frpc 的 TOML 配置，导入前可预览并识别重复项
- **其他**：首次访问引导创建管理员，登录限流；中英文界面、深浅色主题、适配手机

目前不支持 STCP、XTCP 等代理类型，完整的支持范围见[兼容性](docs/guide/compatibility.md)。

## 界面截图

![仪表盘](docs/public/11.png)

<details>
<summary>更多截图</summary>

| 服务器管理 | 代理管理 |
| --- | --- |
| ![服务器管理：实时延迟与地理位置](docs/public/22.png) | ![代理管理](docs/public/33.png) |
| **运行日志** | **导入 TOML** |
| ![实时连接日志](docs/public/44.png) | ![导入 TOML 配置](docs/public/55.png) |
| **添加代理** | |
| ![添加代理表单](docs/public/66.png) | |

</details>

## 快速开始

创建 `docker-compose.yml`：

```yaml
services:
  podux:
    image: ghcr.io/derrors/podux:latest
    container_name: podux
    restart: unless-stopped
    # 使用宿主机网络：代理里的 127.0.0.1 指向宿主机本身
    network_mode: host
    volumes:
      - ./data:/app/pb_data
    environment:
      - TZ=Asia/Shanghai
```

```bash
# 容器以 UID 1000 运行，数据目录需要先交给它
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d
```

启动后访问 `http://<主机>:8090`，首次进入会引导创建管理员账号，之后添加服务器和代理即可。

> [!TIP]
> 使用默认的 bridge 网络（`-p 8090:8090`）时，代理"本地地址"里的 `127.0.0.1` 指向的是**容器自身**，而不是宿主机。要转发宿主机上的服务，请使用 host 网络，或在代理中填写宿主机的局域网 IP。

也可以直接运行[二进制文件](docs/deploy/install/binary.md)（Linux、macOS、Windows），或参考 [Docker 安装](docs/deploy/install/docker.md)使用 `docker run`。

## 文档

| | |
| --- | --- |
| 入门 | [什么是 Podux](docs/guide/what-is-podux.md) · [快速开始](docs/guide/getting-started.md) · [兼容性](docs/guide/compatibility.md) |
| 安装 | [Docker](docs/deploy/install/docker.md) · [二进制](docs/deploy/install/binary.md) |
| 运维 | [数据与备份](docs/deploy/backup.md) · 升级：[Docker](docs/deploy/upgrade/docker.md) / [二进制](docs/deploy/upgrade/binary.md) |
| 问题 | [常见问题](docs/troubleshoot/faq.md) · [Issues](https://github.com/Derrors/podux/issues) |
| 版本 | [Releases](https://github.com/Derrors/podux/releases)：每个版本的变化说明 |
| 开发 | [贡献指南](CONTRIBUTING.md) · [设计文档](development/README.md) |

## 参与贡献

欢迎通过 [Issues](https://github.com/Derrors/podux/issues) 反馈问题或提出建议，也欢迎提交 Pull Request。从源码构建、本地开发和提交前检查见[贡献指南](CONTRIBUTING.md)。

## License

[Apache License 2.0](LICENSE)

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>
