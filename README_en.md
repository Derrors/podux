<a name="readme-top"></a>

<div align="right">
  <a href="README.md">简体中文</a> | <b>English</b>
</div>

<div align="center">
  <a href="https://github.com/Derrors/podux">
    <img src="site/src/assets/logo.png" alt="Logo" width="120">
  </a>

  <h3 align="center">Podux</h3>

  <p align="center">
    A web UI for frpc: manage multiple frps servers, all your proxies, connection status and runtime logs in one place, without editing config files.
  </p>

  <p align="center">
    <a href="https://github.com/Derrors/podux/releases/latest"><img src="https://img.shields.io/github/v/release/Derrors/podux?style=flat-square" alt="Release"></a>
    <a href="https://github.com/Derrors/podux/pkgs/container/podux"><img src="https://img.shields.io/badge/ghcr.io-derrors%2Fpodux-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker"></a>
    <a href="go.mod"><img src="https://img.shields.io/github/go-mod/go-version/Derrors/podux?style=flat-square" alt="Go"></a>
    <img src="https://img.shields.io/badge/frp-v0.71.1-blue?style=flat-square" alt="frp">
    <a href="LICENSE"><img src="https://img.shields.io/github/license/Derrors/podux?style=flat-square" alt="License"></a>
  </p>

  <p align="center">
    <a href="#quick-start"><strong>🚀 Quick Start</strong></a>
    &nbsp;·&nbsp;
    <a href="https://derrors.github.io/podux/en/"><strong>📖 Docs</strong></a>
    &nbsp;·&nbsp;
    <a href="https://github.com/Derrors/podux/releases">📦 Releases</a>
    &nbsp;·&nbsp;
    <a href="https://github.com/Derrors/podux/issues">🐛 Issues</a>
  </p>
</div>

> [!NOTE]
> This repository is an **independently maintained fork** of [luckjiawei/podux](https://github.com/luckjiawei/podux). Since v0.2.0 it evolves on its own and is no longer kept in sync with upstream. Versions, release packages and Docker images (`ghcr.io/derrors/podux`) are published from here; please file issues and suggestions in this repository. See [Relationship to upstream](https://derrors.github.io/podux/en/guide/what-is-podux.html#relationship-to-upstream).

## Overview

[frp](https://github.com/fatedier/frp) is a popular open-source reverse proxy for exposing services behind NAT, but plain frpc is driven entirely by config files: every change means editing `.toml` and restarting, configs get messy once you connect to several frps servers, and there is no view of connection status or latency.

Podux embeds frpc as a library. The backend is built on [PocketBase](https://pocketbase.io/) (with SQLite built in) and the frontend on React. The whole app ships as **a single executable**, plus multi-arch Docker images; once it is running, everything is configured from the browser.

## Features

- **Multiple servers**: connect to several frps servers at once, each with its own frpc instance; token / OIDC auth, tcp, kcp, quic, websocket and wss transports with TLS; optional auto-connect on startup
- **Proxies**: form-based TCP, UDP, HTTP, HTTPS, STCP, SUDP and XTCP proxies with subdomains and custom domains, encryption, compression, bandwidth limits, health checks and the SOCKS5 plugin; port and domain conflicts are caught on save; changes are hot-reloaded and **only proxies whose config changed are restarted**
- **Visitors**: listen on a local port to reach STCP/SUDP/XTCP proxies published by other machines, without a public port on frps
- **Monitoring and alerts**: dashboard and topology chart; periodic latency probes with history charts and server geolocation; live frpc log stream; alerts by webhook (including WeCom, DingTalk and Feishu), Telegram, Bark or email when frps is unreachable, proxies go offline and more
- **Import and export**: import an existing frpc TOML config, with a preview and duplicate detection; export a server's configuration as an `frpc.toml` native frpc can run
- **More**: first-run admin setup and rate-limited login; Chinese / English UI, light / dark theme, mobile-friendly layout

TCPMUX proxies and most proxy plugins are not supported yet; see [Compatibility](https://derrors.github.io/podux/en/guide/compatibility.html) for the full scope.

## Screenshots

![Dashboard](docs/public/11.png)

<details>
<summary>More screenshots</summary>

| Servers | Proxies |
| --- | --- |
| ![Servers: live latency and location](docs/public/22.png) | ![Proxies](docs/public/33.png) |
| **Runtime log** | **TOML import** |
| ![Live connection log](docs/public/44.png) | ![Import a TOML config](docs/public/55.png) |
| **Add a proxy** | |
| ![Add proxy form](docs/public/66.png) | |

</details>

## Quick Start

Create a `docker-compose.yml`:

```yaml
services:
  podux:
    image: ghcr.io/derrors/podux:latest
    container_name: podux
    restart: unless-stopped
    # Host networking: 127.0.0.1 in a proxy means the host itself
    network_mode: host
    volumes:
      - ./data:/app/pb_data
    environment:
      - TZ=Asia/Shanghai
```

```bash
# The container runs as UID 1000, so hand it the data directory first
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d
```

Then open `http://<host>:8090`. The first visit walks you through creating the admin account; then add your servers and proxies.

> [!TIP]
> With the default bridge network (`-p 8090:8090`), `127.0.0.1` as a proxy's local address points to **the container itself**, not the host. To forward services running on the host, use the host network or enter the host's LAN IP in the proxy.

You can also run the [binary](https://derrors.github.io/podux/en/deploy/install/binary.html) directly (Linux, macOS, Windows), or use `docker run` as described in [Docker Installation](https://derrors.github.io/podux/en/deploy/install/docker.html).

## Documentation

| | |
| --- | --- |
| Getting started | [What is Podux](https://derrors.github.io/podux/en/guide/what-is-podux.html) · [Getting started](https://derrors.github.io/podux/en/guide/getting-started.html) · [Compatibility](https://derrors.github.io/podux/en/guide/compatibility.html) |
| Features | [STCP/XTCP and visitors](https://derrors.github.io/podux/en/guide/secret-proxies.html) · [Alerts](https://derrors.github.io/podux/en/guide/notifications.html) · [Export config](https://derrors.github.io/podux/en/guide/export.html) |
| Install | [Docker](https://derrors.github.io/podux/en/deploy/install/docker.html) · [Binary](https://derrors.github.io/podux/en/deploy/install/binary.html) |
| Operations | [Data and backups](https://derrors.github.io/podux/en/deploy/backup.html) · Upgrade: [Docker](https://derrors.github.io/podux/en/deploy/upgrade/docker.html) / [Binary](https://derrors.github.io/podux/en/deploy/upgrade/binary.html) |
| Help | [FAQ](https://derrors.github.io/podux/en/troubleshoot/faq.html) · [Issues](https://github.com/Derrors/podux/issues) |
| Versions | [Releases](https://github.com/Derrors/podux/releases): what changed in each version |
| Development | [Contributing](CONTRIBUTING_en.md) · [Design docs](development/README.md) |

## Contributing

Bug reports and suggestions are welcome in [Issues](https://github.com/Derrors/podux/issues), and pull requests are welcome too. Building from source, local development and pre-submit checks are covered in the [contributing guide](CONTRIBUTING_en.md).

## License

[Apache License 2.0](LICENSE)

<p align="right">(<a href="#readme-top">back to top</a>)</p>
