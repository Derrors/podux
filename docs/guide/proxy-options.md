# 代理进阶设置

代理表单里，除了地址和端口，还可以按代理类型设置以下内容。

## HTTP 设置

仅 HTTP 代理（访问认证和按用户分流也适用于 TCPMUX）：

| 设置 | 作用 |
| --- | --- |
| 访问用户名 / 密码 | 访问这个域名前需要先登录（HTTP Basic 认证） |
| 按用户分流 | 只接收使用这个用户名的请求；多个代理可以共用一个域名，按登录用户分到不同服务 |
| 改写 Host | 转发到本地服务时把 Host 头改成指定值，适合按域名区分站点的本地服务（如 Nginx 虚拟主机） |
| 路径 | 只转发这些路径前缀的请求，例如 `/api`；同一个域名可以按路径分给不同代理 |
| 请求头 / 响应头 | 转发时设置额外的请求头或响应头 |

## TCPMUX

TCPMUX 让多个 TCP 服务共用 frps 的一个端口，按域名区分，客户端通过 HTTP CONNECT 代理连接。frps 需要开启 `tcpmuxHTTPConnectPort`：

```toml
# frps.toml
tcpmuxHTTPConnectPort = 5002
```

在 Podux 中选择 TCPMUX 类型，填写本地地址和自定义域名（或子域名）。客户端连接示例：

```bash
ssh -o 'ProxyCommand nc -X connect -x frps.example.com:5002 %h %p' user@ssh.example.com
```

## 负载均衡

TCP、HTTP、TCPMUX 代理可以设置**分组名**和**分组密钥**。分组名和密钥都相同的代理（可以在不同机器、不同 Podux 上）会共用同一个远程端口或域名，frps 在它们之间轮流分配连接。配合[健康检查](#健康检查)，故障的一端会自动下线，实现主备切换。

同一分组的代理可以使用相同的端口或域名，不会被冲突检查拦下。

## 健康检查

frpc 定期检查本地服务（TCP 连接或 HTTP 请求），连续失败超过设定次数后暂时下线这个代理，恢复后自动重新上线。启用插件时不可用（插件代替了本地服务）。

## 插件

启用插件后，连接由 frpc 自己处理，不再转发到本地地址和端口：

| 插件 | 适用类型 | 作用 |
| --- | --- | --- |
| SOCKS5 | TCP、STCP、XTCP、TCPMUX | 作为 SOCKS5 代理服务器，访问内网 |
| HTTP Proxy | TCP、STCP、XTCP、TCPMUX | 作为 HTTP 代理服务器，访问内网 |
| Static File | TCP、HTTP、STCP、XTCP | 把本机目录作为文件下载站点发布 |
| Unix Socket | TCP、STCP、XTCP、TCPMUX | 发布本机的 Unix 套接字（例如 `/var/run/docker.sock`） |
| HTTP2HTTP | HTTP、TCP | 转发到另一个本地 HTTP 地址，可改写 Host 和请求头 |
| HTTP2HTTPS | HTTP、TCP | 接收 HTTP，以 HTTPS 转发给本地服务 |
| HTTPS2HTTP | HTTPS、TCP | 在本机用证书处理 HTTPS，再以 HTTP 转发给本地服务 |
| HTTPS2HTTPS | HTTPS、TCP | 在本机处理 HTTPS，再以 HTTPS 转发 |
| TLS2Raw | HTTPS、TCP | 在本机处理 TLS，把明文 TCP 转发给本地服务 |

HTTPS2HTTP、HTTPS2HTTPS、TLS2Raw 的证书和私钥可以直接**粘贴 PEM 内容**，Podux 会把它们写入数据目录；也可以填写 Podux 所在机器上的文件路径（Docker 部署需要挂载该文件）。都留空时 frpc 使用自签名证书。

::: tip
Static File 和 Unix Socket 读取的是 **Podux 所在机器**上的目录或套接字；Docker 部署时需要先把它们挂载进容器。
:::

## 有效期

可以给代理设置自动停用时间：1 小时、2 小时、6 小时、1 天、7 天后，或指定时间。到期后代理会自动停用，并发送"临时代理已到期"通知（如已开启，见[告警通知](/guide/notifications)）。适合临时开放 SSH、远程桌面等服务。

代理列表中，临时代理的名称下方会显示剩余时间。再次启用到期的代理时，它不会马上又被停用。

## 批量操作与复制

在代理列表勾选多个代理（当前页），可以一起**启用、停用、迁移到另一台服务器或删除**。批量操作要么全部成功，要么一个都不改：例如启用时其中一个代理与别的代理端口冲突，提示会指出是哪个代理、和谁冲突。

每个代理的**复制**按钮会打开一个预填好的新建表单；复制时会清空远程端口和域名，避免和原代理冲突。

## 冲突检查

保存或启用代理时，Podux 会检查同一服务器上已启用的代理：

- TCP 代理之间、UDP 代理之间不能使用相同的远程端口
- HTTP、HTTPS、TCPMUX 代理不能使用相同的子域名或自定义域名

以下情况不算冲突（frps 本身允许）：同一负载均衡分组；按不同用户分流；HTTP 代理的路径互不重叠。
