# 数据与备份

## 数据目录

Podux 的所有运行数据都在一个数据目录里：

| 部署方式 | 数据目录 |
| --- | --- |
| Docker | 容器内的 `/app/pb_data`（通过 volume 挂载到宿主机） |
| 二进制 | `--dir` 指定的目录；不指定时为可执行文件所在目录下的 `pb_data/` |

目录内容：

| 路径 | 内容 |
| --- | --- |
| `data.db` | 服务器、代理、设置、用户和监控数据 |
| `auxiliary.db` | PocketBase 系统日志 |
| `frpc/frpc.log` | 所有服务器共用的 frpc 日志，按天轮转 |
| `frpc/<服务器 ID>/certs` | 服务器配置的 TLS 证书与私钥 |
| `frpc/<服务器 ID>/plugin-certs` | 代理插件（HTTPS2HTTP 等）中粘贴的证书与私钥 |
| `backups/` | 在界面中创建的备份 |

::: warning 敏感数据
数据目录里保存着 frps 的认证 token 和 TLS 私钥，请限制目录权限，不要把它提交到代码仓库或公开分享。
:::

## 在界面中备份（推荐）

在 **设置** → **备份** 中：

- **立即备份**：把整个数据目录打包成 zip，保存在数据目录的 `backups/` 下
- **自动备份**：每天或每周 03:00，或自定义 cron 表达式，只保留最近的若干份；手动备份不会被自动删除
- **下载 / 上传**：把备份下载到别处保存，或在新机器上上传后恢复
- **恢复**：用备份替换当前的全部数据。Podux 会停止所有隧道、自动重启，恢复后需要重新登录

::: warning
备份文件包含 token、私钥等全部数据，请像对待数据目录一样保护它。备份保存在数据目录里，**磁盘损坏时会一起丢失**，重要的备份请下载到其他地方。
:::

## 手动备份

**停机备份（最简单）**：停止 Podux 后直接复制整个数据目录。

```bash
# Docker Compose
docker compose stop podux
cp -a ./data ./data.bak-$(date +%F)
docker compose start podux

# 二进制（systemd）
sudo systemctl stop podux
sudo cp -a /var/lib/podux /var/lib/podux.bak-$(date +%F)
sudo systemctl start podux
```

**不停机备份**：用 SQLite 的在线备份导出数据库，再单独复制 `frpc/` 目录下的证书。

```bash
sqlite3 data.db ".backup backup.db"
```

## 恢复

界面中的备份直接在 **设置** → **备份** 中恢复。手动备份的恢复方法：停止 Podux，用备份替换整个数据目录（注意保持原有的属主，Docker 中为 UID 1000），然后启动。启动时数据库结构会自动迁移到当前版本。

::: tip 回滚版本
新版本启动后可能已迁移数据库结构。回滚到旧版本时，请同时恢复升级前的数据备份，而不要让旧版本直接读取已迁移的数据。
:::
