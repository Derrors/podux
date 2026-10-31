# Docker 安装

使用 Docker 部署 Podux，适合容器化环境或希望快速隔离部署的场景。

## 前置条件

- Docker 20.10+
- （推荐）Docker Compose v2

## 镜像信息

镜像托管在 GitHub Container Registry：

```text
ghcr.io/derrors/podux:latest
```

- 支持架构：`linux/amd64`、`linux/arm64`、`linux/arm/v7`
- 标签：除 `latest` 外，每个版本都有对应的标签（如 `0.2.7`），生产环境建议固定版本
- 容器内以 UID/GID 1000 运行，数据目录为 `/app/pb_data`，监听 `8090` 端口，内置健康检查（`/api/health`）

## 网络模式

代理的"本地地址"是从**容器内**访问的：

- **host 网络（推荐）**：`127.0.0.1` 指向宿主机本身，转发宿主机上的服务最直接。Podux 直接监听宿主机的 `8090` 端口。
- **bridge 网络**（`-p 8090:8090`）：`127.0.0.1` 指向容器自身。要转发宿主机或局域网中的服务，请在代理中填写宿主机的局域网 IP 或目标机器的 IP。

## Docker Compose（推荐）

创建 `docker-compose.yml`：

```yaml
services:
  podux:
    image: ghcr.io/derrors/podux:${VERSION:-latest}
    container_name: podux
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./data:/app/pb_data
    environment:
      - TZ=Asia/Shanghai
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

创建数据目录并启动：

```bash
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d
```

启动后访问 `http://<主机>:8090`，后续步骤见[快速开始](/guide/getting-started)。

::: tip 使用 bridge 网络
去掉 `network_mode: host`，改为：

```yaml
    ports:
      - "8090:8090"
```
:::

## docker run

```bash
mkdir -p podux-data && sudo chown 1000:1000 podux-data

docker run -d \
  --name podux \
  --restart unless-stopped \
  --network host \
  -v ./podux-data:/app/pb_data \
  -e TZ=Asia/Shanghai \
  ghcr.io/derrors/podux:latest
```

| 参数 | 说明 |
| --- | --- |
| `--network host` | 使用宿主机网络（bridge 网络改为 `-p 8090:8090`） |
| `-v ./podux-data:/app/pb_data` | 持久化数据目录 |
| `-e TZ=Asia/Shanghai` | 时区，影响日志和监控数据的时间 |
| `--restart unless-stopped` | 宿主机重启后自动恢复 |

## 数据持久化

**必须挂载 `/app/pb_data`**，否则容器重建后数据丢失。

- 挂载宿主机目录（如上例）时，目录需要属于 UID 1000，否则 Podux 无法写入数据库。Docker 自动创建的目录属于 root，所以要先手动创建并 `chown`。
- 也可以使用具名 volume（如 `-v podux-data:/app/pb_data`），由 Docker 管理权限，用 `docker volume inspect podux-data` 查看位置。

目录内容与备份方法见[数据与备份](/deploy/backup)。

## 自定义端口

追加 `serve` 参数覆盖默认的监听地址：

```bash
docker run -d \
  --name podux \
  --restart unless-stopped \
  --network host \
  -v ./podux-data:/app/pb_data \
  ghcr.io/derrors/podux:latest \
  serve --http 0.0.0.0:18090
```

Compose 中对应写为 `command: ["serve", "--http", "0.0.0.0:18090"]`。使用 bridge 网络时，还要同步修改端口映射（如 `-p 18090:18090`）。

## 常用命令

```bash
# 查看日志
docker compose logs -f podux

# 停止 / 重启
docker compose stop podux
docker compose restart podux

# 进入容器
docker compose exec podux sh
```

## 下一步

- [快速开始](/guide/getting-started)：添加服务器和代理
- [Docker 升级](/deploy/upgrade/docker)：升级到新版本
