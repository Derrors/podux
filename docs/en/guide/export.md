# Export Config

On a server's detail page, click **Export config** to download the `frpc.toml` the server currently runs: the common settings plus its enabled proxies and visitors. Native frpc can run the file as is, e.g. to move back to a command-line setup, run it on another machine, or see exactly what Podux generates while troubleshooting.

Keep in mind:

- **Proxy and visitor names** are the "name-ID" names Podux uses on frps, such as `ssh-abc123def456ghi`. Keeping them lets existing visitors keep working; if you rename them, update visitors on other machines too.
- **Secrets**: tokens, secret keys and plugin passwords are replaced with `<redacted>` by default; fill them in before use. Tick **Include tokens, keys and other secrets** to export them as is, and keep the file safe.
- **TLS certificates**: Podux stores certificate contents, so the file references `certs/cert.pem`, `certs/key.pem` and `certs/ca.pem` instead, and its header comment lists which files to provide. Copy the contents from the server settings into those paths.
- Disabled proxies and visitors are not exported.

An exported file can also be imported into Podux again on the **Import** page.
