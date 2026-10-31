# Docker Installation

Deploy Podux with Docker — ideal for containerized environments or quick isolated deployments.

## Prerequisites

- Docker 20.10+
- Docker Compose v2 (recommended)

## Image

Images are hosted on GitHub Container Registry:

```text
ghcr.io/derrors/podux:latest
```

- Architectures: `linux/amd64`, `linux/arm64`, `linux/arm/v7`
- Tags: besides `latest`, every release has its own tag (such as `0.2.7`); pin a version in production
- The container runs as UID/GID 1000, keeps data in `/app/pb_data`, listens on port `8090`, and has a built-in health check (`/api/health`)

## Network Mode

A proxy's local address is reached **from inside the container**:

- **Host network (recommended)**: `127.0.0.1` points at the host itself, the most direct way to forward services on the host. Podux listens on the host's port `8090` directly.
- **Bridge network** (`-p 8090:8090`): `127.0.0.1` points at the container. To forward services on the host or LAN, enter the host's LAN IP or the target machine's IP in the proxy.

## Docker Compose (Recommended)

Create `docker-compose.yml`:

```yaml
services:
  podux:
    image: ghcr.io/derrors/podux:${VERSION:-latest}
    container_name: podux
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./data:/app/pb_data
    environment:
      - TZ=Asia/Shanghai
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Create the data directory and start:

```bash
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d
```

Then open `http://<host>:8090`; next steps are in [Getting Started](/en/guide/getting-started).

::: tip Using the bridge network
Remove `network_mode: host` and add:

```yaml
    ports:
      - "8090:8090"
```
:::

## docker run

```bash
mkdir -p podux-data && sudo chown 1000:1000 podux-data

docker run -d \
  --name podux \
  --restart unless-stopped \
  --network host \
  -v ./podux-data:/app/pb_data \
  -e TZ=Asia/Shanghai \
  ghcr.io/derrors/podux:latest
```

| Flag | Description |
| --- | --- |
| `--network host` | Use the host network (for bridge, use `-p 8090:8090` instead) |
| `-v ./podux-data:/app/pb_data` | Persist the data directory |
| `-e TZ=Asia/Shanghai` | Time zone for logs and monitoring timestamps |
| `--restart unless-stopped` | Restart automatically after the host reboots |

## Data Persistence

**You must mount `/app/pb_data`**, or data is lost when the container is recreated.

- When mounting a host directory (as above), it must be owned by UID 1000 or Podux cannot write its database. Directories Docker creates on its own are owned by root, so create it yourself and `chown` it first.
- You can also use a named volume (such as `-v podux-data:/app/pb_data`), whose permissions Docker manages; `docker volume inspect podux-data` shows where it lives.

For the directory's contents and how to back it up, see [Data and Backups](/en/deploy/backup).

## Custom Port

Append `serve` arguments to override the default listen address:

```bash
docker run -d \
  --name podux \
  --restart unless-stopped \
  --network host \
  -v ./podux-data:/app/pb_data \
  ghcr.io/derrors/podux:latest \
  serve --http 0.0.0.0:18090
```

In Compose this is `command: ["serve", "--http", "0.0.0.0:18090"]`. With the bridge network, change the port mapping as well (such as `-p 18090:18090`).

## Common Commands

```bash
# View logs
docker compose logs -f podux

# Stop / restart
docker compose stop podux
docker compose restart podux

# Open a shell in the container
docker compose exec podux sh
```

## Next Steps

- [Getting Started](/en/guide/getting-started) — Add servers and proxies
- [Docker Upgrade](/en/deploy/upgrade/docker) — Upgrade to a new version
