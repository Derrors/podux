# Binary Installation

Install Podux from a prebuilt binary to run it directly on a server or your own machine. The frontend is bundled into the executable; nothing else is required.

## Download

Go to [GitHub Releases](https://github.com/Derrors/podux/releases/latest) and pick the package for your system:

| OS | Architecture | File |
| --- | --- | --- |
| Linux | x86_64 (amd64) | `podux-<version>-linux-amd64.tar.gz` |
| Linux | ARM64 | `podux-<version>-linux-arm64.tar.gz` |
| Linux | ARMv7 | `podux-<version>-linux-arm.tar.gz` |
| macOS | Intel | `podux-<version>-darwin-amd64.tar.gz` |
| macOS | Apple Silicon | `podux-<version>-darwin-arm64.tar.gz` |
| Windows | x86_64 | `podux-<version>-windows-amd64.zip` |

Or download from the command line (Linux amd64 shown; use the latest version):

```bash
VERSION=v0.2.7
curl -LO https://github.com/Derrors/podux/releases/download/${VERSION}/podux-${VERSION}-linux-amd64.tar.gz
curl -LO https://github.com/Derrors/podux/releases/download/${VERSION}/checksums.txt
sha256sum --ignore-missing -c checksums.txt
```

## Install

### Linux / macOS

```bash
tar -xzf podux-${VERSION}-linux-amd64.tar.gz
sudo install -m 755 podux /usr/local/bin/podux
```

### Windows

Extract the `.zip` to any folder, open PowerShell there, and run `.\podux.exe serve`.

## Start

```bash
podux serve --http 0.0.0.0:8090 --dir /var/lib/podux
```

- `--http`: listen address, default `127.0.0.1:8090` (local access only)
- `--dir`: data directory. **Always set it explicitly**: without it, data goes to `pb_data/` next to the executable (or possibly the current directory when invoked through `PATH`), which makes it easy to scatter data

Then open `http://<host>:8090`. On first visit you are guided to create an admin account; next steps are in [Getting Started](/en/guide/getting-started).

## Start on Boot (Linux)

Using systemd to manage Podux is recommended.

**1. Create a dedicated user and data directory**

```bash
sudo useradd -r -s /usr/sbin/nologin podux
sudo mkdir -p /var/lib/podux
sudo chown podux:podux /var/lib/podux
sudo chmod 700 /var/lib/podux
```

**2. Create the systemd unit**

```bash
sudo tee /etc/systemd/system/podux.service > /dev/null <<'EOF'
[Unit]
Description=Podux
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=podux
ExecStart=/usr/local/bin/podux serve --http 0.0.0.0:8090 --dir /var/lib/podux
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF
```

**3. Enable and start the service**

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now podux

# Check status
sudo systemctl status podux
```

## View Logs

```bash
sudo journalctl -u podux -f
```

frpc's own log is written to `frpc/frpc.log` in the data directory, and can also be followed live on a server's log page in the web UI.

## Next Steps

- [Data and Backups](/en/deploy/backup)
- [Binary Upgrade](/en/deploy/upgrade/binary)
