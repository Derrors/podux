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
    <a href="docs/index.md"><strong>📖 文档</strong></a>
    &nbsp;·&nbsp;
    <a href="https://github.com/Derrors/podux/releases">📦 版本发布</a>
    &nbsp;·&nbsp;
    <a href="https://github.com/Derrors/podux/issues">🐛 问题反馈</a>
  </p>
</div>

> [!NOTE]
> 本仓库是 [luckjiawei/podux](https://github.com/luckjiawei/podux) 的**独立维护分支**，由 [Derrors](https://github.com/Derrors) 维护。从 v0.2.0 起，本仓库独立迭代，不再与上游同步；版本、Release 安装包与 Docker 镜像（`ghcr.io/derrors/podux`）均从这里发布，问题与建议请在本仓库提交。详见[与上游的关系](#与上游的关系)。

## 目录

- [简介](#简介)
- [功能特性](#功能特性)
- [界面截图](#界面截图)
- [快速开始](#快速开始)
- [兼容性](#兼容性)
- [数据与备份](#数据与备份)
- [升级](#升级)
- [从源码构建](#从源码构建)
- [文档](#文档)
- [版本历史](#版本历史)
- [与上游的关系](#与上游的关系)
- [参与贡献](#参与贡献)
- [License](#license)

## 简介

[frp](https://github.com/fatedier/frp) 是常用的开源内网穿透工具，但原生 frpc 只能靠配置文件驱动：每次改动都要编辑 `.toml` 再重启，同时连多台 frps 时配置容易混乱，也看不到连接状态和延迟。

Podux 把 frpc 作为库内嵌在程序里，后端基于 [PocketBase](https://pocketbase.io/)（内置 SQLite），前端基于 React。整个应用打包成**一个可执行文件**，也提供多架构 Docker 镜像，部署后在浏览器里完成全部配置。

```text
浏览器 (React)  ──HTTP──▶  Podux (PocketBase + 内嵌 frpc)  ──隧道──▶  frps（自行部署）
                                    │
                                    └── pb_data/：SQLite 数据库、frpc 日志与证书
```

## 功能特性

**服务器（frps）管理**
- 同时连接多台 frps，每台服务器对应一个独立的 frpc 实例，可单独启动、停止
- 支持 token 与 OIDC 认证；传输协议支持 tcp、kcp、quic、websocket、wss，可配置 TLS 证书
- 开启"自动连接"的服务器在 Podux 启动时自动上线
- 删除服务器时一并清理其代理、监控数据，并停止对应的 frpc

**代理管理**
- 可视化表单配置 TCP、UDP、HTTP、HTTPS 代理
- HTTP/HTTPS 支持子域名与多个自定义域名（含通配符），带格式校验
- 支持加密、压缩，TCP 代理可启用 SOCKS5 插件
- 每个代理可单独启用/禁用；修改后自动热重载，**只重启配置有变化的代理**，其他隧道不受影响

**监控与日志**
- 仪表盘：服务器与代理在线统计、拓扑图、最大延迟
- 定时探测服务器延迟，保留历史曲线（按小时、按天聚合，每日数据保留 1 年），并显示服务器地理位置
- 每台服务器的 frpc 运行日志实时推送，断线自动重连，不丢失已显示内容

**导入与其他**
- 导入现有 frpc 的 TOML 配置文件，导入前可预览，并识别重复的服务器和代理
- 首次访问引导创建管理员账号；登录接口限流，防止密码被暴力尝试
- 中文 / 英文界面，浅色 / 深色主题，适配手机
- 内置 PocketBase 管理后台（`/_/`），可直接查看底层数据

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

启动后访问 `http://<主机>:8090`，首次进入会引导创建管理员账号，之后添加服务器和代理即可。

### Docker Compose（推荐）

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
docker compose up -d
```

> [!TIP]
> 如果使用默认的 bridge 网络（`-p 8090:8090`），代理"本地地址"里的 `127.0.0.1` 指向的是**容器自身**，而不是宿主机。要转发宿主机上的服务，请使用 `network_mode: host`，或在代理中填写宿主机的局域网 IP。

### Docker

```bash
docker run -d \
  --name podux \
  --restart unless-stopped \
  --network host \
  -v ./podux-data:/app/pb_data \
  -e TZ=Asia/Shanghai \
  ghcr.io/derrors/podux:latest
```

镜像支持 `linux/amd64`、`linux/arm64`、`linux/arm/v7`。除 `latest` 外，每个版本都有对应的标签（如 `0.2.2`），生产环境建议固定版本。

### 二进制

从 [Releases](https://github.com/Derrors/podux/releases/latest) 下载对应平台的安装包：

| 系统 | 安装包 |
| --- | --- |
| Linux x86_64 / ARM64 / ARMv7 | `podux-<版本>-linux-amd64.tar.gz` / `-linux-arm64.tar.gz` / `-linux-arm.tar.gz` |
| macOS Intel / Apple Silicon | `podux-<版本>-darwin-amd64.tar.gz` / `-darwin-arm64.tar.gz` |
| Windows x86_64 | `podux-<版本>-windows-amd64.zip` |

```bash
tar -xzf podux-v0.2.2-linux-amd64.tar.gz
./podux serve --http 0.0.0.0:8090 --dir /var/lib/podux
```

`--dir` 指定数据目录，不指定时默认为可执行文件所在目录下的 `pb_data/`。下载后可用 Release 中的 `checksums.txt` 校验文件。配置 systemd 开机自启见[二进制安装文档](docs/deploy/install/binary.md)。

## 兼容性

| 项目 | 说明 |
| --- | --- |
| 内嵌 frpc 版本 | v0.71.1 |
| frps 版本 | frp 官方保证 frpc v0.71 与 frps **v0.63 – v0.79** 兼容；更旧的 frps 通常也能连接（v0.61 实测可用），但不在官方保证范围内。混合版本部署时建议先升级 frps |
| 代理类型 | TCP、UDP、HTTP、HTTPS（STCP、XTCP 等类型暂不支持，导入 TOML 时会跳过并提示） |
| 运行平台 | Linux（amd64 / arm64 / armv7）、macOS（amd64 / arm64）、Windows（amd64） |

## 数据与备份

所有运行数据都在数据目录（Docker 中为 `/app/pb_data`）里：

| 路径 | 内容 |
| --- | --- |
| `data.db` | 服务器、代理、设置、用户和监控数据 |
| `auxiliary.db` | PocketBase 系统日志 |
| `frpc/frpc.log` | 所有服务器共用的 frpc 日志，按天轮转 |
| `frpc/<服务器 ID>/certs` | 服务器配置的 TLS 证书与私钥 |

> [!WARNING]
> 数据目录里保存着 frps 的认证 token 和 TLS 私钥，请限制目录权限，不要把它提交到代码仓库或公开分享。

备份时停止容器后直接复制整个数据目录即可；不停机的话，可以用 SQLite 的在线备份（如 `sqlite3 data.db ".backup backup.db"`）。

## 升级

升级前建议先备份数据目录。

```bash
# Docker Compose
docker compose pull && docker compose up -d
```

二进制部署：停止进程，替换可执行文件后重新启动。数据库结构会在启动时自动迁移。各版本的变化见 [Releases](https://github.com/Derrors/podux/releases)，更详细的步骤见 [Docker 升级](docs/deploy/upgrade/docker.md) 与 [二进制升级](docs/deploy/upgrade/binary.md)。

## 从源码构建

环境要求：Go 1.26、Node.js 22、pnpm 10。

```bash
git clone https://github.com/Derrors/podux.git && cd podux

# 构建前端，并复制到 pb_public（Go 通过 go:embed 打包进二进制）
pnpm --dir site install --frozen-lockfile
pnpm --dir site run build
rm -rf pb_public && mkdir -p pb_public && cp -R site/dist/. pb_public/

# 构建并运行
go build -o podux .
./podux serve --http 0.0.0.0:8090
```

- **本地开发**：`go run . serve` 启动后端，`pnpm --dir site run dev` 启动前端开发服务器（会把 `/api` 代理到 `127.0.0.1:8090`）
- **多平台打包**：`build/build.sh --arch all`（`--help` 查看全部选项）
- **Docker 镜像**：`docker compose -f deploy/docker-compose.build.yml up -d --build`

| 目录 | 内容 |
| --- | --- |
| `main.go` | 启动入口与依赖装配 |
| `internal/` | 后端：领域模型、应用服务（frpc、监控、导入等）、持久化、HTTP 接口 |
| `migrations/` | PocketBase 数据库结构迁移 |
| `site/` | 前端（React 19 + TypeScript + Vite + Radix Themes + Tailwind CSS） |
| `docs/` | 使用文档（VitePress） |
| `development/` | 架构、数据库与 UI 设计文档 |

## 文档

- [快速开始](docs/guide/getting-started.md) · [配置说明](docs/guide/configuration.md)
- 安装：[Docker](docs/deploy/install/docker.md) · [二进制](docs/deploy/install/binary.md)
- 升级：[Docker](docs/deploy/upgrade/docker.md) · [二进制](docs/deploy/upgrade/binary.md)
- [API 说明](docs/api/overview.md) · [常见问题](docs/troubleshoot/faq.md)
- 开发者：[架构设计](development/architecture.md) · [数据库设计](development/database-design.md) · [UI 规范](development/ui-spec.md)

## 版本历史

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v0.2.2 | 2026-10-29 | frp 升级到 v0.71.1；修复 OIDC 认证、加密/压缩开关、编辑代理导致全部隧道重启、代理页空白等问题 |
| v0.2.1 | 2026-10-29 | 删除服务器级联清理、登录限流、日志流断线重连等修复 |
| v0.2.0 | 2026-10-29 | 本分支首个版本 |
| v0.1.0 – v0.1.6 | 2026-03 | 上游 [luckjiawei/podux](https://github.com/luckjiawei/podux) 发布的版本 |

每个版本的完整说明见 [Releases](https://github.com/Derrors/podux/releases)。

## 与上游的关系

- Podux 最初由 [luckjiawei](https://github.com/luckjiawei)（刘嘉伟）创建，前身名为 frpc-hub。本仓库以上游 v0.1.6 之后的代码为基础分出，从 v0.2.0 开始独立维护。
- 之后的功能、修复与版本节奏由本仓库自行决定，**不保证与上游行为或版本号一致**，也不会定期合并上游改动。
- 本仓库的 Docker 镜像为 `ghcr.io/derrors/podux`，与上游镜像不同；从上游版本迁移时，沿用原有的数据目录即可。
- 感谢原作者的工作。项目沿用 Apache 2.0 许可证，原有版权声明保持不变。

## 参与贡献

欢迎通过 [Issues](https://github.com/Derrors/podux/issues) 反馈问题或提出建议，也欢迎提交 Pull Request。提交代码前请阅读 [AGENT.md](AGENT.md) 中的开发约定，并确保以下检查通过：

```bash
pnpm --dir site run lint && pnpm --dir site run build
go vet ./... && go test ./...
```

## License

[Apache License 2.0](LICENSE)

<p align="right">(<a href="#readme-top">回到顶部</a>)</p>
