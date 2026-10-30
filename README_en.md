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
    <a href="docs/en/index.md"><strong>📖 Docs</strong></a>
    &nbsp;·&nbsp;
    <a href="https://github.com/Derrors/podux/releases">📦 Releases</a>
    &nbsp;·&nbsp;
    <a href="https://github.com/Derrors/podux/issues">🐛 Issues</a>
  </p>
</div>

> [!NOTE]
> This repository is an **independently maintained fork** of [luckjiawei/podux](https://github.com/luckjiawei/podux), maintained by [Derrors](https://github.com/Derrors). Since v0.2.0 it evolves on its own and is no longer kept in sync with upstream. Versions, release packages and Docker images (`ghcr.io/derrors/podux`) are published from here; please file issues and suggestions in this repository. See [Relationship to upstream](#relationship-to-upstream).

## Contents

- [Overview](#overview)
- [Features](#features)
- [Screenshots](#screenshots)
- [Quick Start](#quick-start)
- [Compatibility](#compatibility)
- [Data and backups](#data-and-backups)
- [Upgrading](#upgrading)
- [Building from source](#building-from-source)
- [Documentation](#documentation)
- [Release history](#release-history)
- [Relationship to upstream](#relationship-to-upstream)
- [Contributing](#contributing)
- [License](#license)

## Overview

[frp](https://github.com/fatedier/frp) is a popular open-source reverse proxy for exposing services behind NAT, but plain frpc is driven entirely by config files: every change means editing `.toml` and restarting, configs get messy once you connect to several frps servers, and there is no view of connection status or latency.

Podux embeds frpc as a library. The backend is built on [PocketBase](https://pocketbase.io/) (with SQLite built in) and the frontend on React. The whole app ships as **a single executable**, plus multi-arch Docker images; once it is running, everything is configured from the browser.

```text
Browser (React)  ──HTTP──▶  Podux (PocketBase + embedded frpc)  ──tunnel──▶  frps (self-hosted)
                                    │
                                    └── pb_data/: SQLite databases, frpc logs and certificates
```

## Features

**Server (frps) management**
- Connect to several frps servers at once; each server gets its own frpc instance that can be started and stopped on its own
- Token and OIDC authentication; tcp, kcp, quic, websocket and wss transports; custom TLS certificates
- Servers with "auto connect" come online when Podux starts
- Deleting a server also removes its proxies and metrics and stops its frpc

**Proxy management**
- Form-based configuration for TCP, UDP, HTTP and HTTPS proxies
- HTTP/HTTPS proxies support a subdomain and multiple custom domains (wildcards allowed), with format validation
- Encryption and compression; TCP proxies can use the SOCKS5 plugin
- Each proxy can be enabled or disabled; changes are hot-reloaded and **only proxies whose config changed are restarted**, other tunnels keep running

**Monitoring and logs**
- Dashboard: server and proxy status counts, topology chart, max latency
- Periodic server latency probes with history charts (hourly and daily rollups, daily data kept for one year), plus server geolocation
- Live frpc log stream per server, reconnecting automatically without losing lines already shown

**Import and more**
- Import an existing frpc TOML config, with a preview and detection of duplicate servers and proxies
- First-run setup wizard for the admin account; the login endpoint is rate-limited against password guessing
- Chinese / English UI, light / dark theme, mobile-friendly layout
- The PocketBase admin UI (`/_/`) is included for inspecting the underlying data

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

Once it is running, open `http://<host>:8090`. The first visit walks you through creating the admin account; then add your servers and proxies.

### Docker Compose (recommended)

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
docker compose up -d
```

> [!TIP]
> With the default bridge network (`-p 8090:8090`), `127.0.0.1` as a proxy's local address points to **the container itself**, not the host. To forward services running on the host, use `network_mode: host` or enter the host's LAN IP in the proxy.

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

Images are built for `linux/amd64`, `linux/arm64` and `linux/arm/v7`. Besides `latest`, every release has its own tag (e.g. `0.2.2`); pinning a version is recommended for production.

### Binary

Download the package for your platform from [Releases](https://github.com/Derrors/podux/releases/latest):

| OS | Package |
| --- | --- |
| Linux x86_64 / ARM64 / ARMv7 | `podux-<version>-linux-amd64.tar.gz` / `-linux-arm64.tar.gz` / `-linux-arm.tar.gz` |
| macOS Intel / Apple Silicon | `podux-<version>-darwin-amd64.tar.gz` / `-darwin-arm64.tar.gz` |
| Windows x86_64 | `podux-<version>-windows-amd64.zip` |

```bash
tar -xzf podux-v0.2.2-linux-amd64.tar.gz
./podux serve --http 0.0.0.0:8090 --dir /var/lib/podux
```

`--dir` sets the data directory; without it, data goes to `pb_data/` next to the executable. Each release includes `checksums.txt` for verifying downloads. For running it as a systemd service, see the [binary install guide](docs/en/deploy/install/binary.md).

## Compatibility

| Item | Details |
| --- | --- |
| Embedded frpc | v0.71.1 |
| frps | frp guarantees frpc v0.71 works with frps **v0.63 – v0.79**. Older frps usually connects too (v0.61 was tested), but is outside that guarantee. In mixed deployments, upgrade frps first |
| Proxy types | TCP, UDP, HTTP, HTTPS (STCP, XTCP and other types are not supported yet; a TOML import skips them with a warning) |
| Platforms | Linux (amd64 / arm64 / armv7), macOS (amd64 / arm64), Windows (amd64) |

## Data and backups

All runtime data lives in the data directory (`/app/pb_data` in Docker):

| Path | Contents |
| --- | --- |
| `data.db` | Servers, proxies, settings, users and metrics |
| `auxiliary.db` | PocketBase system logs |
| `frpc/frpc.log` | frpc log shared by all servers, rotated daily |
| `frpc/<server id>/certs` | TLS certificates and private keys configured for a server |

> [!WARNING]
> The data directory holds frps auth tokens and TLS private keys. Restrict its permissions and never commit or share it.

To back up, stop the container and copy the whole data directory. Without downtime, use SQLite's online backup (e.g. `sqlite3 data.db ".backup backup.db"`).

## Upgrading

Back up the data directory before upgrading.

```bash
# Docker Compose
docker compose pull && docker compose up -d
```

For binary installs, stop the process, replace the executable and start it again. Database migrations run automatically on startup. See [Releases](https://github.com/Derrors/podux/releases) for what changed in each version, and the [Docker](docs/en/deploy/upgrade/docker.md) and [binary](docs/en/deploy/upgrade/binary.md) upgrade guides for details.

## Building from source

Requirements: Go 1.26, Node.js 22, pnpm 10.

```bash
git clone https://github.com/Derrors/podux.git && cd podux

# Build the frontend and copy it to pb_public (embedded into the binary via go:embed)
pnpm --dir site install --frozen-lockfile
pnpm --dir site run build
rm -rf pb_public && mkdir -p pb_public && cp -R site/dist/. pb_public/

# Build and run
go build -o podux .
./podux serve --http 0.0.0.0:8090
```

- **Local development**: `go run . serve` for the backend, `pnpm --dir site run dev` for the frontend dev server (it proxies `/api` to `127.0.0.1:8090`)
- **Multi-platform packages**: `build/build.sh --arch all` (`--help` lists all options)
- **Docker image**: `docker compose -f deploy/docker-compose.build.yml up -d --build`

| Path | Contents |
| --- | --- |
| `main.go` | Entry point and dependency wiring |
| `internal/` | Backend: domain models, application services (frpc, monitoring, import, …), persistence, HTTP handlers |
| `migrations/` | PocketBase schema migrations |
| `site/` | Frontend (React 19 + TypeScript + Vite + Radix Themes + Tailwind CSS) |
| `docs/` | User documentation (VitePress) |
| `development/` | Architecture, database and UI design docs |

## Documentation

- [Getting started](docs/en/guide/getting-started.md) · [What is Podux](docs/en/guide/what-is-podux.md)
- Install: [Docker](docs/en/deploy/install/docker.md) · [Binary](docs/en/deploy/install/binary.md)
- Upgrade: [Docker](docs/en/deploy/upgrade/docker.md) · [Binary](docs/en/deploy/upgrade/binary.md)
- [FAQ](docs/en/troubleshoot/faq.md)
- For developers: [Architecture](development/architecture.md) · [Database design](development/database-design.md) · [UI spec](development/ui-spec.md)

## Release history

| Version | Date | Notes |
| --- | --- | --- |
| v0.2.2 | 2026-10-29 | frp upgraded to v0.71.1; fixes OIDC auth, the encryption/compression switches, all tunnels restarting on any proxy edit, the blank Proxies page, and more |
| v0.2.1 | 2026-10-29 | Cascading server deletes, login rate limiting, log stream reconnect fixes |
| v0.2.0 | 2026-10-29 | First release of this fork |
| v0.1.0 – v0.1.6 | 2026-03 | Released by upstream [luckjiawei/podux](https://github.com/luckjiawei/podux) |

Full notes for every version are on the [Releases](https://github.com/Derrors/podux/releases) page.

## Relationship to upstream

- Podux was created by [luckjiawei](https://github.com/luckjiawei) and was previously called frpc-hub. This repository branched off upstream code from after v0.1.6 and has been maintained independently since v0.2.0.
- Features, fixes and release cadence are decided here. Behavior and version numbers are **not guaranteed to match upstream**, and upstream changes are not merged on a regular basis.
- This fork's Docker image is `ghcr.io/derrors/podux`, not the upstream image. When moving from an upstream version, keep using your existing data directory.
- Thanks to the original author. The project stays under the Apache 2.0 license with the original copyright notice intact.

## Contributing

Bug reports and suggestions are welcome in [Issues](https://github.com/Derrors/podux/issues), and pull requests are welcome too. Before submitting code, read the conventions in [AGENT.md](AGENT.md) and make sure these checks pass:

```bash
pnpm --dir site run lint && pnpm --dir site run build
go vet ./... && go test ./...
```

## License

[Apache License 2.0](LICENSE)

<p align="right">(<a href="#readme-top">back to top</a>)</p>
