# FAQ

## Basics & Installation

### How is Podux different from plain frpc?

Podux embeds frpc as a library and adds a web UI for managing servers and proxies, watching connection status and latency, and following logs live. There are no config files to edit by hand, and changes take effect automatically.

### Which systems and frps versions are supported?

See [Compatibility](/en/guide/compatibility).

### Where is data stored, and how do I back it up?

See [Data and Backups](/en/deploy/backup).

## Configuration & Usage

### Can I import my existing `frpc.toml`?

Yes. Upload the TOML file on the **Import** page, preview it, and choose which proxies to import. A server with the same address and port, and proxies with the same name under it, are recognized as existing. Note:

- Unsupported proxy types such as STCP and XTCP are skipped with a warning
- TLS certificates are imported by content only; certificate file paths in the config are ignored, so paste the certificate contents into the server settings after importing

### How do configuration changes take effect?

After you save a proxy, Podux hot-reloads that server's frpc. Only proxies whose configuration changed are restarted; other tunnels on the same server are not affected. Changes to a server's own connection settings take effect after you restart that server.

### Which proxy types are supported?

**TCP**, **UDP**, **HTTP** and **HTTPS**. STCP, SUDP, XTCP and TCPMUX are not supported yet.

## Troubleshooting

### With Docker, proxies cannot reach services on the host

With the bridge network (`-p 8090:8090`), `127.0.0.1` in a proxy's local address points at the container itself. Use the host network instead, or enter the host's LAN IP in the proxy; see [Docker Installation](/en/deploy/install/docker#network-mode).

### The Docker container keeps restarting with "permission denied" in its logs

The mounted host directory is not owned by the container user (UID 1000). Run `sudo chown -R 1000:1000 <data directory>` and restart the container.

### A server cannot connect

Open the server's log from its detail page to see frpc's error. Common causes: wrong address or port, a token that does not match frps, an frps version that is too old (see [Compatibility](/en/guide/compatibility)), or a firewall blocking the frps port.

### How do I report a problem?

Open an issue on [GitHub Issues](https://github.com/Derrors/podux/issues) with your Podux version, deployment method, relevant logs and steps to reproduce. Mask tokens and other secrets in logs first.
