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
| `frpc/<server ID>/plugin-certs` | Certificates and keys pasted into proxy plugins (HTTPS2HTTP and others) |
| `backups/` | Backups made in the UI |

::: warning Sensitive data
The data directory holds frps auth tokens and TLS private keys. Restrict its permissions, and never commit it to a repository or share it publicly.
:::

## Backing Up in the UI (Recommended)

Under **Settings** → **Backups**:

- **Back up now**: zips the whole data directory into `backups/` inside it
- **Automatic backups**: daily or weekly at 03:00, or a custom cron expression, keeping only the latest few; manual backups are never removed automatically
- **Download / upload**: keep a copy elsewhere, or upload one on a new machine to restore it
- **Restore**: replaces all current data with the backup. Podux stops all tunnels, restarts, and you sign in again

::: warning
Backup files contain everything, including tokens and private keys; protect them like the data directory. They are stored inside the data directory, so **a disk failure loses them too**: download important backups elsewhere.
:::

Restore runs as one background job. The UI reports success only after data replacement is confirmed and the new process has booted; a healthy old process is not proof of success. Uploads validate ZIP paths and the `data.db` header. Failures have an explicit result. A timeout does not mean the operation was canceled: check service logs before retrying rather than submitting repeatedly.

Only the latest restore job is retained, queryable for 24 hours, in `backups/.podux-restore.json` (permissions `0600`). It is excluded from new archives and survives restore. This file contains a random capability that can only read that job's status; do not share it publicly. Online restore relies on PocketBase's UNIX restart mechanism and is not supported on Windows.

Podux is a single-process deployment: upgrades, restarts and restores interrupt its tunnels. It does not promise zero-downtime restore or support multiple instances sharing a data directory.

## Manual Backups

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

Restore UI backups from **Settings** → **Backups**. For a manual backup: stop Podux, replace the whole data directory with the backup (keep the original owner; UID 1000 for Docker), then start it. The database schema is migrated to the current version on startup.

::: tip Rolling back a version
A newer version may already have migrated the database schema when it started. When rolling back to an older version, restore the backup taken before the upgrade as well, instead of letting the older version read the migrated data.
:::
