# STCP/XTCP and Visitors

A regular TCP proxy opens a public port on frps that anyone can connect to. STCP, SUDP and XTCP proxies **open no public port**: only machines running a **visitor** with the same secret key can connect. They suit SSH, remote desktop, NAS admin pages and other services you don't want on the internet.

| Type | Description |
| --- | --- |
| STCP | TCP traffic relayed through frps |
| SUDP | UDP traffic relayed through frps |
| XTCP | TCP traffic over a direct peer-to-peer connection (traffic skips frps); if the direct connection fails, the visitor cannot connect. Good for heavy traffic, but depends on the network |

The path needs both ends:

```text
Machine being reached (publishes the proxy)        Machine reaching it (runs the visitor)
Podux / frpc ── STCP proxy "nas"     ⇄  frps  ⇄   Podux / frpc ── visitor on 127.0.0.1:6000
     └── local service 127.0.0.1:5000                    └── you connect to 127.0.0.1:6000
```

Both ends must use **the same frps**. Either end can be managed by Podux or run native frpc.

## Step 1: Publish an STCP/XTCP Proxy

On the machine being reached:

1. **Proxies** → **Add Proxy**, type **STCP** (or SUDP, XTCP)
2. Enter the local address and port, such as `127.0.0.1:5000`
3. **Secret key**: a random key is generated when you pick the type; the visitor must use the same value
4. **Allowed users** (optional): empty allows only visitors of the same frps user; `*` allows anyone; separate several users with commas
5. Save

After saving, the "Remote port / domain" column of the proxy list shows the **name for visitors**, such as `nas-abc123def456ghi`. Podux registers proxies on frps as "name-ID", so the visitor needs this full name, not just `nas`.

## Step 2: Add a Visitor

On the machine reaching it:

1. **Visitors** → **Add visitor**
2. Choose the server that uses **the same frps** as the proxy
3. Fill in the target proxy:
   - If the target proxy is in this Podux too, use **Fill from a Podux proxy**; it fills in the server, type, name and key
   - Otherwise enter the **Proxy name** (copied in step 1) and **Secret key**; if the target's frpc uses a different `user`, enter it as **Proxy user**
4. Enter the local **Listen address** and **Listen port**, such as `127.0.0.1:6000`. `127.0.0.1` accepts local connections only; `0.0.0.0` accepts the LAN
5. Encryption and compression must match the target proxy
6. Save

If the server is running, the visitor takes effect as soon as it is saved. Connecting to `127.0.0.1:6000` then reaches `127.0.0.1:5000` on the other machine.

## Native frpc on the Other End

A visitor in frpc.toml:

```toml
[[visitors]]
name = "nas-visitor"
type = "stcp"
serverName = "nas-abc123def456ghi"   # the name copied from the Podux proxy list
secretKey = "the proxy's secret key"
bindAddr = "127.0.0.1"
bindPort = 6000
```

The other way round, a proxy published by native frpc is named by its `name` setting; enter that in the Podux visitor.

## Import

When importing `frpc.toml`, STCP/SUDP/XTCP proxies are imported like other proxies, and `[[visitors]]` appear in the preview's Visitors section, where you choose whether to import them and whether to overwrite visitors with the same name. Proxy types that are still unsupported, such as TCPMUX, are skipped with a warning.
