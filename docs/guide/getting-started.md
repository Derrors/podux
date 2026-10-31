# 快速开始

本指南用 Docker Compose 在几分钟内跑起 Podux，并添加第一台服务器和第一个代理。其他安装方式见 [Docker 安装](/deploy/install/docker) 与 [二进制安装](/deploy/install/binary)。

## 前置条件

- 已安装 [Docker](https://docs.docker.com/get-docker/) 与 Docker Compose v2
- 一台已部署 frps 的服务器（或第三方 frp 服务），版本要求见[兼容性](/guide/compatibility)

## 第一步：启动 Podux

新建一个目录，在其中创建 `docker-compose.yml`：

```yaml
services:
  podux:
    image: ghcr.io/derrors/podux:latest
    container_name: podux
    restart: unless-stopped
    # 使用宿主机网络：代理里的 127.0.0.1 指向宿主机本身
    network_mode: host
    volumes:
      - ./data:/app/pb_data
    environment:
      - TZ=Asia/Shanghai
```

容器内以 UID 1000 运行，需要先创建数据目录并交给它，然后启动：

```bash
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d
```

::: tip 为什么用 host 网络
使用默认的 bridge 网络（`ports: ["8090:8090"]`）时，代理"本地地址"里的 `127.0.0.1` 指向的是**容器自身**，而不是宿主机。要转发宿主机上的服务，请使用 `network_mode: host`，或在代理中填写宿主机的局域网 IP。
:::

## 第二步：创建管理员账号

浏览器访问 `http://<主机>:8090`，首次进入会引导你用邮箱和密码创建管理员账号，之后用它登录。

::: warning 安全提示
如果 Podux 能从公网访问，请设置强密码，并尽量通过防火墙或反向代理限制 `8090` 端口的访问来源。
:::

## 第三步：添加服务器

1. 点击左侧导航栏的 **服务器**，再点击 **添加服务器**
2. 填写 frps 的连接信息：

   | 字段 | 说明 | 示例 |
   | --- | --- | --- |
   | 名称 | 服务器的显示名称 | `我的服务器` |
   | 服务器地址 | frps 所在主机的 IP 或域名 | `your-server.com` |
   | 服务器端口 | frps 的 `bindPort`，默认 `7000` | `7000` |
   | 认证 | 与 frps 一致，常用 token（对应 frps 的 `auth.token`） | `your-token` |

3. 保存后在服务器列表中启动它。开启 **自动连接** 的服务器会在 Podux 每次启动时自动上线。

连接成功后，服务器显示为运行中，并开始显示延迟和地理位置。

## 第四步：添加代理

1. 点击 **代理**，再点击 **添加代理**
2. 选择代理类型并填写配置。以把本机 SSH（22 端口）映射到公网为例：

   | 字段 | 值 |
   | --- | --- |
   | 名称 | `my-ssh` |
   | 类型 | `TCP` |
   | 服务器 | 选择上一步添加的服务器 |
   | 本地 IP | `127.0.0.1` |
   | 本地端口 | `22` |
   | 远程端口 | `6022` |

3. 保存后 Podux 会自动热重载 frpc 配置，无需重启。

之后即可通过 `ssh -p 6022 user@your-server.com` 访问本机。

::: tip 已有 frpc 配置？
在 **导入** 页面上传现有的 `frpc.toml`，预览后即可批量导入服务器、代理和访问端。服务器的认证设置（包括 [OIDC](/guide/oidc)）也会一起导入；无法识别的代理类型会被跳过并提示。
:::

## PocketBase 管理后台（可选）

Podux 内置 PocketBase 管理后台（`/_/`），可以直接查看底层数据，日常使用不需要它。它使用独立的超级管理员账号，可以通过以下任一方式创建：

- 首次启动时，PocketBase 会在启动日志里打印一个创建超级管理员的链接（`docker compose logs podux` 查看）
- 或直接用命令创建：

  ```bash
  docker compose exec podux /app/podux superuser upsert admin@example.com <密码>
  ```

## 下一步

- [STCP/XTCP 与访问端](/guide/secret-proxies)：不开放公网端口访问内网服务
- [告警通知](/guide/notifications)：服务器或代理异常时收到提醒
- [数据与备份](/deploy/backup)：数据目录里有什么、如何备份
- [Docker 升级](/deploy/upgrade/docker)：升级到新版本
- [常见问题](/troubleshoot/faq)
