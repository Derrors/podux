# Binary Upgrade

To upgrade a binary deployment: back up the data, replace the executable, and start it again. The database schema is migrated on startup. See [Releases](https://github.com/Derrors/podux/releases) for what changed in each version.

The commands below assume the systemd setup from [Binary Installation](/en/deploy/install/binary) (data directory `/var/lib/podux`).

## Upgrade Steps

### 1. Stop the Service and Back Up Data

```bash
sudo systemctl stop podux
sudo cp -a /var/lib/podux /var/lib/podux.bak-$(date +%F)
```

Without systemd, stop the Podux process first, then back up the directory passed to `--dir`.

### 2. Download the New Version

```bash
VERSION=v0.2.4
curl -LO https://github.com/Derrors/podux/releases/download/${VERSION}/podux-${VERSION}-linux-amd64.tar.gz
tar -xzf podux-${VERSION}-linux-amd64.tar.gz
```

### 3. Replace the Executable and Start

```bash
sudo install -m 755 podux /usr/local/bin/podux
sudo systemctl start podux

# Check status
sudo systemctl status podux
```

## Rolling Back

A newer version may already have migrated the database schema, so roll back the data as well:

```bash
sudo systemctl stop podux

# Restore the pre-upgrade backup
sudo rm -rf /var/lib/podux
sudo cp -a /var/lib/podux.bak-<date> /var/lib/podux

# Download the old version from GitHub Releases, replace /usr/local/bin/podux, then start
sudo systemctl start podux
```
