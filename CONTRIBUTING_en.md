# Contributing

<div align="right">
  <a href="CONTRIBUTING.md">简体中文</a> | <b>English</b>
</div>

Bug reports and suggestions are welcome in [Issues](https://github.com/Derrors/podux/issues), and pull requests are welcome too.

## Reporting Issues

Include your Podux version, deployment method (Docker / binary), frps version, relevant logs and steps to reproduce. Mask tokens, certificates and other secrets in logs first.

## Building from Source

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

- **Local development**: `go run . serve` for the backend, `pnpm --dir site run dev` for the frontend dev server (it proxies `/api` to `127.0.0.1:8090`). `pb_public/index.html` must exist before the backend starts, so build the frontend once as above
- **Docs site**: `pnpm --dir docs install --frozen-lockfile && pnpm --dir docs run docs:dev`
- **Multi-platform packages**: `build/build.sh --arch all` (`--help` lists all options)
- **Docker image**: `docker compose -f deploy/docker-compose.build.yml up -d --build`

## Repository Layout

| Path | Contents |
| --- | --- |
| `main.go` | Entry point and dependency wiring |
| `internal/` | Backend: domain models, application services (frpc, monitoring, import, …), persistence, HTTP handlers |
| `migrations/` | PocketBase schema migrations |
| `site/` | Frontend (React 19 + TypeScript + Vite + Radix Themes + Tailwind CSS) |
| `docs/` | User documentation (VitePress) |
| `development/` | [Architecture](development/architecture.md), [database](development/database-design.md) and [UI](development/ui-spec.md) design docs |

## Conventions

Read [AGENT.md](AGENT.md) before submitting code; it covers layering, migrations, i18n, the UI spec and security boundaries. In short:

- Schema changes need a new `migrations/*.go` migration; never edit the database directly
- Update both `site/src/locales/zh.json` and `en.json` for UI text
- When endpoints, data structures or auth rules change, update the design docs under `development/`
- When user-visible behavior changes, update the Chinese and English docs under `docs/`

## Pre-Submit Checks

```bash
pnpm --dir site install --frozen-lockfile
pnpm --dir site run lint
pnpm --dir site run build
pnpm --dir docs install --frozen-lockfile
pnpm --dir docs run docs:build

# go:embed needs pb_public to exist
rm -rf pb_public && mkdir -p pb_public && cp -R site/dist/. pb_public/
go vet ./...
go test ./...
go build ./...
```

Never commit `pb_data/`, `pb_public/`, `site/dist/`, build artifacts, or any tokens, certificates or user data.
