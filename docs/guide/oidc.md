# OIDC 认证

除了 token，frpc 还可以用 OIDC 登录 frps：frpc 用客户端凭据模式（client credentials）向身份提供方（Keycloak、Authentik、Azure AD、Auth0 等）申请令牌，frps 校验令牌的签名、签发方和受众。这样不用在每台机器上分发同一个 token，也可以在身份提供方那里单独停用某个客户端。

## frps 端

frps 需要能访问身份提供方，启动时会读取 `<issuer>/.well-known/openid-configuration`：

```toml
auth.method = "oidc"
auth.oidc.issuer = "https://sso.example.com/realms/home"
auth.oidc.audience = "frps"
```

## 身份提供方

为 Podux 创建一个**机密客户端**（confidential client），开启客户端凭据模式，并让签发的令牌带上 frps 要求的受众（`aud`）。以 Keycloak 为例：开启 Client authentication 和 Service accounts roles，再添加一个 Audience 映射，值为 `frps`。

## Podux 端

在服务器表单的 **认证** 中选择 **OIDC**：

| 字段 | 说明 |
| --- | --- |
| Client ID | 必填，身份提供方中的客户端 ID |
| Client Secret | 客户端密钥 |
| 令牌端点 | 必填，完整的 `http://` 或 `https://` 地址，例如 Keycloak 的 `https://sso.example.com/realms/home/protocol/openid-connect/token` |
| Audience | 令牌的受众，和 frps 的 `auth.oidc.audience` 一致。有的身份提供方用映射来设置受众，这里可以留空 |
| Scope | 申请的 scope，多个用空格分隔 |
| 附加请求参数 | 随令牌请求发送的其他参数，例如 Azure 的 `resource`。`scope` 不能写在这里；填了 Audience 时也不能再写 `audience` |
| 令牌端点的 CA 证书 | 身份提供方用自签名证书时粘贴或上传 CA，Podux 会把它写到服务器的 `certs/oidc-ca.pem` |
| 跳过证书校验 | 不校验身份提供方的 HTTPS 证书，仅用于排查问题 |

**附加认证范围** 对 token 和 OIDC 都适用：frps 设置了 `auth.additionalScopes = ["HeartBeats", "NewWorkConns"]` 时，在这里勾选对应的项，否则心跳或新建的工作连接会被 frps 拒绝。

客户端密钥和 token 一样保存在数据库中。日志中会隐藏它，[导出配置](/guide/export) 时默认替换为 `<redacted>`。

## 排查

连接失败时，在服务器详情页查看 frpc 日志：

- `couldn't generate OIDC token for login`：frpc 没有拿到令牌。后面通常跟着身份提供方的错误，例如 `invalid_client` 表示 Client ID 或密钥不对；证书错误时检查 CA 证书
- 拿到了令牌但 frps 拒绝登录：检查令牌的受众是否和 frps 的 `auth.oidc.audience` 一致，签发方是否和 `auth.oidc.issuer` 完全相同（包括末尾的 `/`）

[导入](/guide/getting-started) 已有的 frpc 配置时，`[auth.oidc]` 中的设置会一起导入。`trustedCaFile` 是文件路径，Podux 无法读取，导入后请在表单中重新上传 CA 证书。
