# Docker Upgrade

To upgrade a Docker deployment, pull the new image and recreate the container; data is kept in the mounted data directory. The database schema is migrated on startup. See [Releases](https://github.com/Derrors/podux/releases) for what changed in each version.

::: tip Back up first
Back up the data directory before upgrading, see [Data and Backups](/en/deploy/backup). You will need this backup to roll back.
:::

## Docker Compose Upgrade (Recommended)

```bash
# Pull the new image, then recreate and start the container
docker compose pull
docker compose up -d

# Check status
docker compose ps
```

Old images are not removed automatically; clean them up with:

```bash
docker image prune -f
```

## docker run Upgrade

```bash
docker pull ghcr.io/derrors/podux:latest

# Stop and remove the old container (data in the mounted directory is kept)
docker stop podux
docker rm podux

# Start the new container with the same flags used at install time
docker run -d \
  --name podux \
  --restart unless-stopped \
  --network host \
  -v ./podux-data:/app/pb_data \
  -e TZ=Asia/Shanghai \
  ghcr.io/derrors/podux:latest
```

## Upgrade to a Specific Version

Replace the `latest` tag with a version number (without the `v`), for example:

```yaml
image: ghcr.io/derrors/podux:0.2.4
```

If your `docker-compose.yml` uses `${VERSION:-latest}` (see [Docker Installation](/en/deploy/install/docker)), you can also run:

```bash
VERSION=0.2.4 docker compose up -d
```

## Rolling Back

A newer version may already have migrated the database schema, so roll back the data together with the image:

```bash
docker compose down

# Replace the data directory with the pre-upgrade backup
rm -rf ./data && cp -a ./data.bak-<date> ./data

# Point the image tag back at the old version and start
VERSION=0.2.3 docker compose up -d
```
