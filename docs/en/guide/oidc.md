# OIDC Authentication

Besides a token, frpc can sign in to frps with OIDC: frpc requests a token from an identity provider (Keycloak, Authentik, Azure AD, Auth0 and others) with the client credentials grant, and frps checks the token's signature, issuer and audience. There is no shared token to hand out to every machine, and you can disable a single client at the identity provider.

## frps

frps must be able to reach the identity provider; it reads `<issuer>/.well-known/openid-configuration` on startup:

```toml
auth.method = "oidc"
auth.oidc.issuer = "https://sso.example.com/realms/home"
auth.oidc.audience = "frps"
```

## Identity Provider

Create a **confidential client** for Podux with the client credentials grant enabled, and make its tokens carry the audience (`aud`) frps expects. In Keycloak, for example: turn on Client authentication and Service accounts roles, then add an Audience mapper with the value `frps`.

## Podux

In the server form, choose **OIDC** under **Authentication**:

| Field | Description |
| --- | --- |
| Client ID | Required; the client ID at the identity provider |
| Client Secret | The client secret |
| Token endpoint | Required; a full `http://` or `https://` URL, such as Keycloak's `https://sso.example.com/realms/home/protocol/openid-connect/token` |
| Audience | The token audience, matching frps's `auth.oidc.audience`. Leave it empty when the identity provider sets the audience with a mapper |
| Scope | Scopes to request, space-separated |
| Additional request parameters | Other parameters sent with the token request, such as Azure's `resource`. `scope` is not allowed here, nor `audience` when Audience is set |
| CA certificate for the token endpoint | Paste or upload the CA when the identity provider has a self-signed certificate; Podux writes it to the server's `certs/oidc-ca.pem` |
| Skip certificate verification | Does not check the identity provider's HTTPS certificate; for troubleshooting only |

**Additional auth scopes** apply to both token and OIDC: when frps sets `auth.additionalScopes = ["HeartBeats", "NewWorkConns"]`, check the same scopes here, or frps rejects the heartbeats or new work connections.

The client secret is stored in the database like a token. Logs hide it, and [exports](/en/guide/export) replace it with `<redacted>` by default.

## Troubleshooting

When the connection fails, check the frpc log on the server's detail page:

- `couldn't generate OIDC token for login`: frpc did not get a token. The identity provider's error usually follows; `invalid_client` means the client ID or secret is wrong. For certificate errors, check the CA certificate
- A token was issued but frps refuses the login: check that the token audience matches frps's `auth.oidc.audience` and that the issuer matches `auth.oidc.issuer` exactly, including any trailing `/`

When [importing](/en/guide/getting-started) an existing frpc configuration, the `[auth.oidc]` settings are imported too. `trustedCaFile` is a file path Podux cannot read, so upload the CA certificate in the form after importing.
