# Getting Started

This guide gets Podux running with Docker Compose in a few minutes, then adds your first server and proxy. For other install methods, see [Docker Installation](/en/deploy/install/docker) and [Binary Installation](/en/deploy/install/binary).

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Docker Compose v2
- A server running frps (or a third-party frp service); see [Compatibility](/en/guide/compatibility) for supported versions

## Step 1: Start Podux

Create a directory and put a `docker-compose.yml` in it:

```yaml
services:
  podux:
    image: ghcr.io/derrors/podux:latest
    container_name: podux
    restart: unless-stopped
    # Host network: 127.0.0.1 in a proxy points at the host itself
    network_mode: host
    volumes:
      - ./data:/app/pb_data
    environment:
      - TZ=Asia/Shanghai
```

The container runs as UID 1000, so create the data directory and hand it over first, then start:

```bash
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d
```

::: tip Why the host network
With the default bridge network (`ports: ["8090:8090"]`), `127.0.0.1` in a proxy's local address points at **the container itself**, not the host. To forward services on the host, use `network_mode: host`, or enter the host's LAN IP in the proxy.
:::

## Step 2: Create the Admin Account

Open `http://<host>:8090` in a browser. On first visit you are guided to create an admin account with an email and password; use it to sign in afterwards.

::: warning Security
If Podux is reachable from the internet, use a strong password and restrict access to port `8090` with a firewall or reverse proxy where possible.
:::

## Step 3: Add a Server

1. Click **Servers** in the sidebar, then **Add Server**
2. Fill in the frps connection details:

   | Field | Description | Example |
   | --- | --- | --- |
   | Name | Display name | `My Server` |
   | Server address | IP or domain of the frps host | `your-server.com` |
   | Server port | frps `bindPort`, default `7000` | `7000` |
   | Authentication | Must match frps; usually a token (frps `auth.token`) | `your-token` |

3. Save, then start it from the server list. Servers with **Auto connect** enabled come online every time Podux starts.

Once connected, the server shows as running and starts displaying latency and location.

## Step 4: Add a Proxy

1. Click **Proxies**, then **Add Proxy**
2. Choose a proxy type and fill in the settings. For example, to expose local SSH (port 22):

   | Field | Value |
   | --- | --- |
   | Name | `my-ssh` |
   | Type | `TCP` |
   | Server | The server added in the previous step |
   | Local IP | `127.0.0.1` |
   | Local port | `22` |
   | Remote port | `6022` |

3. After saving, Podux hot-reloads the frpc configuration automatically; no restart needed.

You can now reach the machine with `ssh -p 6022 user@your-server.com`.

::: tip Already have an frpc config?
Upload your existing `frpc.toml` on the **Import** page to preview and import its server, proxies and visitors in one go. Server auth settings, including [OIDC](/en/guide/oidc), are imported too; unknown proxy types are skipped with a warning.
:::

## PocketBase Admin UI (Optional)

Podux includes the PocketBase admin UI (`/_/`) for inspecting the underlying data; everyday use does not need it. It uses a separate superuser account, which you can create either way:

- On first start, PocketBase prints a link for creating the first superuser in the startup log (`docker compose logs podux`)
- Or create it with a command:

  ```bash
  docker compose exec podux /app/podux superuser upsert admin@example.com <password>
  ```

## Next Steps

- [STCP/XTCP and Visitors](/en/guide/secret-proxies): reach internal services without a public port
- [Alerts](/en/guide/notifications): get notified when a server or proxy has a problem
- [Data and Backups](/en/deploy/backup): what is in the data directory and how to back it up
- [Docker Upgrade](/en/deploy/upgrade/docker): upgrade to a new version
- [FAQ](/en/troubleshoot/faq)
