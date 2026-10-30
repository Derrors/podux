# What is Podux?

Podux is a **modern frpc management platform** built on PocketBase and React, providing a visual interface to manage intranet penetration services.

## Dashboard

![Podux Dashboard](/11.png)

## The Name

**Podux** = **proxy** + **port** + **dux** (Latin: leader, guide)

The name itself is a statement of intent: not just a frontend for one tool, but a unified platform to lead and guide your tunneling infrastructure.

## Why the Rename?

Podux started life as **frpc-hub** — a project built around frpc. As it grew, the vision became clear: support not just frp, but become a unified platform for managing multiple tunneling tools.

The name **frpc-hub** tied the project to a single tool and couldn't carry that larger ambition. **Podux** reflects where the project is headed — a single, forward-looking platform that can grow to support more protocols and tools beyond frp.

> The rename happened in March 2026. The repository and all related references have been updated accordingly.

## Background

[frp](https://github.com/fatedier/frp) is one of the most popular open-source intranet penetration tools. Its client `frpc` establishes tunnels with the server `frps` via configuration files (`.toml` / `.ini`), exposing local services to the public internet.

However, using native frpc comes with several pain points:

- **Config-file-driven only**: Every change requires manually editing files and restarting the process
- **Difficult multi-server management**: Maintaining multiple frps servers leads to scattered, error-prone configs
- **No visual monitoring**: No intuitive way to view connection status or latency
- **High operational cost**: Upgrades, backups, and migrations are all manual

Podux was built to solve exactly these problems.

## Core Features

### Server Management

Centrally manage multiple frps servers with support for:

- One independent frpc instance per server, started and stopped individually
- Token and OIDC authentication; tcp, kcp, quic, websocket and wss transports, with configurable TLS certificates
- Servers with "auto connect" come online when Podux starts
- Periodic latency probes with history charts, plus server geolocation
- Deleting a server also removes its proxies and monitoring data

### Proxy Management

Create and manage proxy tunnels via visual forms. Supported proxy types:

| Type | Description |
| --- | --- |
| TCP | General-purpose TCP port forwarding |
| UDP | UDP traffic forwarding |
| HTTP | HTTP reverse proxy |
| HTTPS | HTTPS reverse proxy |
| STCP / SUDP | No public port; only visitors with the secret key can connect |
| XTCP | Same, over a direct peer-to-peer connection that skips frps |
| TCPMUX | Several TCP services share one frps port, told apart by domain |

Each proxy can also use encryption, compression, a bandwidth limit, a health check, HTTP sign-in and path routing, a load balancing group, plugins (SOCKS5, static files, HTTPS2HTTP and more) and an expiry; see [Proxy Options](/en/guide/proxy-options). Saving checks for port and domain conflicts and names the conflicting proxy; the proxy list enables, disables, moves and deletes proxies in batches.

### Visitors

Listen on a local port to reach STCP/SUDP/XTCP proxies published by other machines; see [STCP/XTCP and Visitors](/en/guide/secret-proxies).

### Alerts and Export

- Read each proxy's traffic from the frps dashboard and probe from outside whether proxies are really reachable; see [Traffic and Reachability](/en/guide/traffic)
- Get notified through webhooks (including WeCom, DingTalk and Feishu), Telegram, Bark or email when frps is unreachable or slow, proxies go offline or become unreachable, or frpc exits; see [Alerts](/en/guide/notifications)
- Export a server's configuration as an `frpc.toml` native frpc can run; see [Export Config](/en/guide/export)
- Back up, schedule backups and restore all data in the UI; see [Data and Backups](/en/deploy/backup)

### Hot Reload

After changing proxies or visitors, Podux automatically triggers an frpc reload — **no manual restart required**. Only proxies whose config changed are restarted; the server's other proxies keep running.

### Modern Interface

Built with Radix UI and Tailwind CSS, delivering a clean and elegant UI with Chinese/English language switching.

## Architecture

```text
Browser (React)  ──HTTP──▶  Podux (PocketBase + embedded frpc)  ──tunnel──▶  frps (self-hosted)
                                     │
                                     └── pb_data/: SQLite database, frpc logs and certificates
```

- **Frontend**: React + Radix UI + Tailwind CSS, bundled into the executable
- **Backend**: [PocketBase](https://pocketbase.io/) with built-in SQLite, handling accounts, storage and the API
- **frpc**: embedded as a Go library inside the Podux process, one instance per server; no separate frpc install is needed

Podux ships as a **single executable** that embeds both the PocketBase backend and frontend assets — ready to run with zero extra dependencies.

## Comparison with Manual Management

| | Manual frpc | Podux |
| --- | --- | --- |
| Configuration | Edit `.toml` files | Visual forms |
| Reload config | Restart process manually | Automatic hot reload |
| Multi-server | Maintain multiple config files | Unified dashboard |
| Status monitoring | Read logs | Real-time monitoring panel |
| Cross-platform deploy | Requires environment setup | Single file, ready to run |

## Use Cases

- **Developers**: Quickly expose local dev environments (web services, databases, SSH) to the internet for testing or demos
- **DevOps engineers**: Manage intranet penetration configs across multiple machines from one place
- **Home users**: Set up home servers, NAS, or remote desktop without memorizing complex config syntax

## Relationship to Upstream

- Podux was created by [luckjiawei](https://github.com/luckjiawei) and was previously named frpc-hub. [Derrors/podux](https://github.com/Derrors/podux) branched off after upstream v0.1.6 and has been maintained independently since v0.2.0.
- Features, fixes and release cadence are decided in this repository. Behavior and version numbers are **not guaranteed to match upstream**, and upstream changes are not merged on a schedule.
- This repository's Docker image is `ghcr.io/derrors/podux`, which differs from the upstream image. When migrating from an upstream release, keep using your existing data directory.
- Thanks to the original author. The project keeps the Apache 2.0 license and the existing copyright notices.

## Next Steps

- [Getting Started](/en/guide/getting-started) — Up and running in minutes
- [Compatibility](/en/guide/compatibility) — Supported frps versions and feature scope
