# Docker 升级

升级 Docker 部署的 Podux，只需拉取新镜像并重建容器，数据通过挂载的数据目录保留。数据库结构会在启动时自动迁移。各版本的变化见 [Releases](https://github.com/Derrors/podux/releases)。

::: tip 先备份
升级前建议先备份数据目录，见[数据与备份](/deploy/backup)。回滚到旧版本时需要用到这份备份。
:::

## Docker Compose 升级（推荐）

```bash
# 拉取新镜像，重建并启动容器
docker compose pull
docker compose up -d

# 确认运行状态
docker compose ps
```

旧镜像不会自动删除，可手动清理：

```bash
docker image prune -f
```

## docker run 升级

```bash
docker pull ghcr.io/derrors/podux:latest

# 停止并删除旧容器（数据在挂载的目录中，不会丢失）
docker stop podux
docker rm podux

# 用与安装时相同的参数启动新容器
docker run -d \
  --name podux \
  --restart unless-stopped \
  --network host \
  -v ./podux-data:/app/pb_data \
  -e TZ=Asia/Shanghai \
  ghcr.io/derrors/podux:latest
```

## 升级到指定版本

把镜像标签从 `latest` 换成版本号（不带 `v`），例如：

```yaml
image: ghcr.io/derrors/podux:0.2.7
```

如果 `docker-compose.yml` 使用了 `${VERSION:-latest}`（见 [Docker 安装](/deploy/install/docker)），也可以直接：

```bash
VERSION=0.2.7 docker compose up -d
```

## 回滚

新版本启动后可能已经迁移了数据库结构，回滚时要连同数据一起恢复：

```bash
docker compose down

# 用升级前的备份替换数据目录
rm -rf ./data && cp -a ./data.bak-<日期> ./data

# 把镜像标签改回旧版本后启动
VERSION=0.2.6 docker compose up -d
```
