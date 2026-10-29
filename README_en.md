<a name="readme-top"></a>

<!-- PROJECT SHIELDS -->

[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![Apache License][license-shield]][license-url]

<div align="right">
  <a href="README.md">简体中文</a> | <b>English</b>
</div>

> **Fork:** This repository is an independently maintained fork of [luckjiawei/podux](https://github.com/luckjiawei/podux), maintained by [Derrors](https://github.com/Derrors). Releases and Docker images (`ghcr.io/derrors/podux`) are published from here.

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/Derrors/podux">
    <img src="site/src/assets/logo.png" alt="Logo" width="140">
  </a>

<h3 align="center">Podux</h3>

  <p align="center">
    <strong>Podux</strong> is the web UI frpc always needed.
    <br />
    Manage all your clients, proxies, and connections from one place. No terminal. No config editing.
    <br /><br />
    <a href="docs/en/guide/getting-started.md"><strong>🚀 Quick Start</strong></a>
    &nbsp;&nbsp;·&nbsp;&nbsp;
    <a href="docs/en/index.md"><strong>📖 Documentation</strong></a>
    &nbsp;&nbsp;·&nbsp;&nbsp;
    <a href="https://github.com/Derrors/podux/issues">🐛 Report Bug</a>
    &nbsp;&nbsp;·&nbsp;&nbsp;
    <a href="https://github.com/Derrors/podux/issues">✨ Request Feature</a>
  </p>

  <br />

  <p align="center">
    <strong>✅ Multi-server management</strong> &nbsp;·&nbsp;
    <strong>📊 Real-time dashboard</strong> &nbsp;·&nbsp;
    <strong>🌐 Network monitoring</strong> &nbsp;·&nbsp;
    <strong>🚀 One-click auto-start</strong> &nbsp;·&nbsp;
    <strong>⚡ High performance</strong> &nbsp;·&nbsp;
    <strong>🐳 Docker ready</strong> &nbsp;·&nbsp;
    <strong>🎨 Modern UI</strong> &nbsp;·&nbsp;
  </p>

</div>

## Screenshot

![Screenshot](screenshot/1.png)

## Quick Start

```bash
docker run -d \
  --name podux \
  --restart unless-stopped \
  -p 8090:8090 \
  -v ./podux-data:/app/pb_data \
  ghcr.io/derrors/podux:latest
```

Then open `http://localhost:8090`; the first visit walks you through creating the admin account. For Docker Compose or binary installs, see [Docker install](docs/en/deploy/install/docker.md) and [Binary install](docs/en/deploy/install/binary.md).

## Milestones

- 2026-03-03: Released v0.1.0
- 2026-03-12: Released v0.1.1
- 2026-03-14: Released v0.1.2
- 2026-03-16: Released v0.1.3
- 2026-03-25: Released v0.1.4
- 2026-03-26: Released v0.1.5
- 2026-03-31: Released v0.1.6
- 2026-10-29: Released v0.2.0 (first release of this fork)
- 2026-10-29: Released v0.2.1

See [Releases](https://github.com/Derrors/podux/releases) for full release notes.

## License

[Apache 2.0](LICENSE)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Derrors/podux&type=Date)](https://www.star-history.com/#Derrors/podux&Date)

<!-- MARKDOWN LINKS & IMAGES -->

[forks-shield]: https://img.shields.io/github/forks/Derrors/podux.svg?style=for-the-badge
[forks-url]: https://github.com/Derrors/podux/network/members
[stars-shield]: https://img.shields.io/github/stars/Derrors/podux.svg?style=for-the-badge
[stars-url]: https://github.com/Derrors/podux/stargazers
[issues-shield]: https://img.shields.io/github/issues/Derrors/podux.svg?style=for-the-badge
[issues-url]: https://github.com/Derrors/podux/issues
[license-shield]: https://img.shields.io/github/license/Derrors/podux.svg?style=for-the-badge
[license-url]: https://github.com/Derrors/podux/blob/main/LICENSE
