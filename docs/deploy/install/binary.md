# 二进制安装

通过预编译的二进制文件安装 Podux，适合直接在服务器或本地机器上运行。前端已打包进可执行文件，无需其他依赖。

## 下载

前往 [GitHub Releases](https://github.com/Derrors/podux/releases/latest)，根据系统选择安装包：

| 系统 | 架构 | 文件名 |
| --- | --- | --- |
| Linux | x86_64 (amd64) | `podux-<版本>-linux-amd64.tar.gz` |
| Linux | ARM64 | `podux-<版本>-linux-arm64.tar.gz` |
| Linux | ARMv7 | `podux-<版本>-linux-arm.tar.gz` |
| macOS | Intel | `podux-<版本>-darwin-amd64.tar.gz` |
| macOS | Apple Silicon | `podux-<版本>-darwin-arm64.tar.gz` |
| Windows | x86_64 | `podux-<版本>-windows-amd64.zip` |

也可以用命令行下载（以 Linux amd64 为例，版本号换成最新版本）：

```bash
VERSION=v0.2.7
curl -LO https://github.com/Derrors/podux/releases/download/${VERSION}/podux-${VERSION}-linux-amd64.tar.gz
curl -LO https://github.com/Derrors/podux/releases/download/${VERSION}/checksums.txt
sha256sum --ignore-missing -c checksums.txt
```

## 安装

### Linux / macOS

```bash
tar -xzf podux-${VERSION}-linux-amd64.tar.gz
sudo install -m 755 podux /usr/local/bin/podux
```

### Windows

解压 `.zip` 文件到任意目录，在该目录中打开 PowerShell 运行 `.\podux.exe serve`。

## 启动

```bash
podux serve --http 0.0.0.0:8090 --dir /var/lib/podux
```

- `--http`：监听地址，默认 `127.0.0.1:8090`（只能本机访问）
- `--dir`：数据目录。**建议总是显式指定**：不指定时，数据目录为可执行文件所在目录下的 `pb_data/`（通过 `PATH` 调用时则可能落在当前目录），容易导致数据分散

启动后访问 `http://<主机>:8090`，首次进入会引导创建管理员账号，后续步骤见[快速开始](/guide/getting-started)。

## 配置开机自启（Linux）

推荐使用 systemd 管理 Podux 进程。

**1. 创建专用用户和数据目录**

```bash
sudo useradd -r -s /usr/sbin/nologin podux
sudo mkdir -p /var/lib/podux
sudo chown podux:podux /var/lib/podux
sudo chmod 700 /var/lib/podux
```

**2. 创建 systemd 服务文件**

```bash
sudo tee /etc/systemd/system/podux.service > /dev/null <<'EOF'
[Unit]
Description=Podux
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=podux
ExecStart=/usr/local/bin/podux serve --http 0.0.0.0:8090 --dir /var/lib/podux
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF
```

**3. 启用并启动服务**

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now podux

# 查看运行状态
sudo systemctl status podux
```

## 查看日志

```bash
sudo journalctl -u podux -f
```

frpc 自身的日志写在数据目录的 `frpc/frpc.log`，也可以在 Web 界面的服务器日志页实时查看。

## 下一步

- [数据与备份](/deploy/backup)
- [二进制升级](/deploy/upgrade/binary)
