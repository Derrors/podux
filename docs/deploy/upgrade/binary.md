# 二进制升级

升级二进制部署的 Podux：备份数据，替换可执行文件，再重新启动。数据库结构会在启动时自动迁移。各版本的变化见 [Releases](https://github.com/Derrors/podux/releases)。

以下命令以[二进制安装](/deploy/install/binary)中的 systemd 部署为例（数据目录 `/var/lib/podux`）。

## 升级步骤

### 1. 停止服务并备份数据

```bash
sudo systemctl stop podux
sudo cp -a /var/lib/podux /var/lib/podux.bak-$(date +%F)
```

未使用 systemd 时，先结束 Podux 进程，再备份启动时 `--dir` 指定的目录。

### 2. 下载新版本

```bash
VERSION=v0.2.2
curl -LO https://github.com/Derrors/podux/releases/download/${VERSION}/podux-${VERSION}-linux-amd64.tar.gz
tar -xzf podux-${VERSION}-linux-amd64.tar.gz
```

### 3. 替换可执行文件并启动

```bash
sudo install -m 755 podux /usr/local/bin/podux
sudo systemctl start podux

# 确认服务正常运行
sudo systemctl status podux
```

## 回滚

新版本启动后可能已经迁移了数据库结构，回滚时要连同数据一起恢复：

```bash
sudo systemctl stop podux

# 恢复升级前的数据备份
sudo rm -rf /var/lib/podux
sudo cp -a /var/lib/podux.bak-<日期> /var/lib/podux

# 从 GitHub Releases 下载旧版本，替换 /usr/local/bin/podux 后启动
sudo systemctl start podux
```
