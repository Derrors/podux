# System Architecture

## Verified Current State

Podux is a single Go/PocketBase service that hosts the API, SQLite persistence, background monitoring, frpc client services, and the React static site. The code calls running instances `processes`, but `internal/application/frpc/service.go` actually creates in-process `frp/client.Service` instances and runs them in goroutines; it does not launch separate `frpc` OS processes.

```mermaid
flowchart LR
  B[Browser / React Web<br/>site/src] -->|PocketBase collection API| PB[PocketBase / Go<br/>main.go]
  B -->|custom /api routes| H[HTTP handlers<br/>internal/interfaces/http]
  H --> A[Application services<br/>internal/application]
  PB --> H
  A --> D[Domain contracts/models<br/>internal/domain]
  A --> R[Repository implementations<br/>internal/infrastructure/persistence]
  R --> DB[(SQLite / PocketBase collections<br/>pb_data)]
  PB --> DB
  A --> F[frp client.Service instances<br/>in-process goroutines]
  F --> FRPS[Remote frps servers]
  A --> M[MonitorService + MetricsScheduler]
  M --> DB
  PB --> E[Embedded React assets<br/>pb_public]
```

### Layers and Entry Points

- `main.go` creates the PocketBase app, registers migration commands, constructs repositories/services/handlers, binds the `fh_proxies` create/update/delete hooks and the `OnTerminate` hook that stops frpc clients, and initializes state, starts background tasks, registers routes, and configures the static-file fallback in `OnServe`.
- `internal/domain` currently defines lightweight models, status values, and repository interfaces only for servers and proxies.
- `internal/application` handles statistics, imports, frpc configuration/lifecycle, networking and metrics, system settings, and version queries.
- `internal/infrastructure/persistence` implements server and proxy repositories with dbx/PocketBase.
- `internal/interfaces/http` exposes `/api/dashboard/*`, `/api/frpc/*`, `/api/import/*`, `/api/servers*`, `/api/system/*`, and `/api/frp/version`. Except for initialization-status and initialization endpoints, registered custom routes use `requireAuth`, which only accepts the `Authorization` header (the log stream no longer takes a `?token=` query parameter; the frontend reads it with `fetch`). `/api/servers` list items omit `auth`, `transport`, `log`, and `metadatas`; edit forms load full records through the PocketBase SDK.
- React also uses the PocketBase SDK directly for `fh_users`, `fh_servers`, and `fh_proxies`; collection API rules control that access boundary.

### Typical Request Flow

```mermaid
sequenceDiagram
  participant UI as React Servers page
  participant H as FrpcHandler
  participant S as frpc.Service
  participant R as server/proxy repositories
  participant DB as PocketBase/SQLite
  participant C as frp client.Service
  UI->>H: POST /api/frpc/launch {id}
  H->>H: requireAuth + 15-char id validation
  H->>S: LaunchFrpc(id)
  S->>DB: load fh_servers
  S->>R: FindEnabledByServerID(id)
  R->>DB: query fh_proxies
  S->>C: NewService + Run(ctx)
  S->>R: bootStatus = running
  H-->>UI: 200 / 409 already running / error
  loop every 5 seconds
    S->>C: StatusExporter
    S->>R: proxy bootStatus online/offline (written only on change)
  end
```

Standard server/proxy CRUD primarily uses the PocketBase SDK. Server lists, dashboard data, imports, settings, and runtime controls use custom APIs. After a successful `fh_proxies` create, update, or delete, a hook calls `ReloadFrpc` for each affected running server (both the old and new server when a proxy moves); the frontend does not call `/api/frpc/reload` itself.

[frpc.Service](../internal/application/frpc/service.go) keeps one instance per server. `LaunchFrpc` reserves the slot before building the config, so a second launch returns `ErrAlreadyRunning` (HTTP 409). `TerminateFrpc` waits up to 10 seconds for the client to exit, and an exiting instance only clears the map entry and statuses it still owns, so a quick stop/start cannot mark the new instance stopped.

frp logs through one package-level logger, so all servers share `pb_data/frpc/frpc.log`. Each server's run context carries an xlog prefix `[podux:<id>]`; [logs.go](../internal/application/frpc/logs.go) filters the stream to that server and to its configured log level. The shared logger uses the most verbose level any launched server has requested. frp lines without a server context (a handful of global messages) are not shown in any server's log view.

### Startup Flow and Background Tasks

1. Go `init` loads `migrations`; `main` registers the migrate command and wires dependencies.
2. PocketBase `serve` triggers `OnServe`, which sets every server to `stopped` and every proxy to `offline`.
3. After a 10-second delay, servers with `autoConnection=true` start automatically.
4. `MonitorService` immediately runs TCP latency and missing-geolocation checks, then repeats them at intervals from `fh_settings.general`; server-side defaults are 30 seconds (clamped to 10–300 seconds, matching the settings page) and 24 hours. Saving settings applies new intervals to the running tickers without a restart. The latest probe result per server, including failures, is held in memory by `MetricsService`; only successful latencies are written to `fh_metrics_raw`. Before a server's first probe after startup, its latest stored value from the last 10 minutes is used.
5. PocketBase cron aggregates raw metrics into hourly metrics at minute 5 of every hour. At 01:05 each day it aggregates daily metrics and deletes raw data older than 7 days and hourly data older than 30 days.
6. After handlers are registered, `pb_public` is served through `embed.FS` with an SPA fallback; `/_/` remains the PocketBase Admin UI.

### Frontend Build and Embedding

```mermaid
flowchart LR
  SRC[site/src React + TypeScript] -->|pnpm run build| DIST[site/dist]
  DIST -->|build/build.sh copy| PUBLIC[pb_public]
  PUBLIC -->|go:embed all:pb_public| BIN[Podux Go binary]
  BIN -->|apis.Static fallback| WEB[Browser]
```

The Vite development server listens on `0.0.0.0` and proxies `/api` to `127.0.0.1:8090`. Production builds do not automatically copy files to `pb_public`; CI performs that step through artifact downloads, while `build/build.sh` copies them explicitly. Go compilation still requires the directory to exist when `pb_public/index.html` is missing, and runtime logs a warning.

## Configuration, Persistence, and Deployment Boundaries

- PocketBase uses `pb_data/` as its default data root; the Docker volume mounts `/app/pb_data`. The database, uploads, the shared `pb_data/frpc/frpc.log`, and `pb_data/frpc/<id>/certs` are runtime data. Older versions wrote per-server logs to `pb_data/frpc/<id>/logs`; those files are no longer read.
- Server connection/authentication/transport/logging/metadata settings are stored in collection JSON fields. TLS certificate contents are written to a server-specific certificates directory at startup, with private-key permissions set to `0600`. Never commit this content.
- The fixed system-settings record ID is `wcstsqmz8hur331`; the initialization transaction creates both the first `fh_users` record and the settings record.
- Geolocation and version queries access external services and depend on network availability. frpc instance status exists only in memory; database statuses are reset together on restart.
- The Dockerfile builds React and then compiles a static Go binary; deployment files define ports and volumes. This document makes no claims about production reverse proxies, backups, or high availability that are not verified in repository configuration.

## CI and Quality Boundaries

`.github/workflows/ci.yml` runs on pushes to main/dev and pull requests to main. It performs a frozen frontend install, lint, Vitest tests, and a production build (whose `tsc -b` is the type check); it then downloads the frontend artifact and runs `go vet`, `go test -race`, and a Linux amd64 build. CI does not build the documentation site, but this project's pre-submission baseline requires that check locally. Pushes to dev also build and publish a multi-architecture container.

## To Be Confirmed

- `github_handler.go` and its service exist, but their wiring and registration are commented out in `main.go`; they must not be treated as a published API.
- `MonitorService` has no graceful-shutdown hook; it relies on process termination. frpc clients are stopped in `OnTerminate` (kcp/quic close gracefully).
- No formal repository-level backup/restore, horizontal-scaling, or multi-instance mutual-exclusion design was found.
