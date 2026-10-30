# Data and Backups

## Data Directory

All of Podux's runtime data lives in one data directory:

| Deployment | Data directory |
| --- | --- |
| Docker | `/app/pb_data` inside the container (mounted from the host) |
| Binary | The directory given with `--dir`; without it, `pb_data/` next to the executable |

Contents:

| Path | Contents |
| --- | --- |
| `data.db` | Servers, proxies, settings, users and monitoring data |
| `auxiliary.db` | PocketBase system logs |
| `frpc/frpc.log` | frpc log shared by all servers, rotated daily |
| `frpc/<server ID>/certs` | TLS certificates and private keys configured on servers |

::: warning Sensitive data
The data directory holds frps auth tokens and TLS private keys. Restrict its permissions, and never commit it to a repository or share it publicly.
:::

## Backing Up

**Offline backup (simplest)**: stop Podux and copy the whole data directory.

```bash
# Docker Compose
docker compose stop podux
cp -a ./data ./data.bak-$(date +%F)
docker compose start podux

# Binary (systemd)
sudo systemctl stop podux
sudo cp -a /var/lib/podux /var/lib/podux.bak-$(date +%F)
sudo systemctl start podux
```

**Online backup**: export the database with SQLite's online backup, then copy the certificates under `frpc/` separately.

```bash
sqlite3 data.db ".backup backup.db"
```

## Restoring

Stop Podux, replace the whole data directory with the backup (keep the original owner; UID 1000 for Docker), then start it. The database schema is migrated to the current version on startup.

::: tip Rolling back a version
A newer version may already have migrated the database schema when it started. When rolling back to an older version, restore the backup taken before the upgrade as well, instead of letting the older version read the migrated data.
:::
