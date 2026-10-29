<a name="readme-top"></a>

<!-- PROJECT SHIELDS -->

[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![Apache License][license-shield]][license-url]

<div align="right">
  <b>简体中文</b> | <a href="README_en.md">English</a>
</div>

> **说明：** 本仓库是 [luckjiawei/podux](https://github.com/luckjiawei/podux) 的独立维护分支，由 [Derrors](https://github.com/Derrors) 维护，版本与 Docker 镜像（`ghcr.io/derrors/podux`）从这里发布。

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/Derrors/podux">
    <img src="site/src/assets/logo.png" alt="Logo" width="140">
  </a>

<h3 align="center">Podux</h3>

  <p align="center">
    <strong>Podux</strong> —— frpc 梦寐以求的 Web 前端管理面板。
    <br />
    在一个地方集中管理您所有的客户端、代理和连接。告别终端。无需再手动编辑配置文件。
    <br /><br />
    <a href="docs/guide/getting-started.md"><strong>🚀 快速开始</strong></a>
    &nbsp;&nbsp;·&nbsp;&nbsp;
    <a href="docs/index.md"><strong>📖 文档</strong></a>
    &nbsp;&nbsp;·&nbsp;&nbsp;
    <a href="https://github.com/Derrors/podux/issues">🐛 提交 Bug</a>
    &nbsp;&nbsp;·&nbsp;&nbsp;
    <a href="https://github.com/Derrors/podux/issues">✨ 需求建议</a>
  </p>

  <br />

  <p align="center">
    <strong>✅ 多节点管理</strong> &nbsp;·&nbsp;
    <strong>📊 实时数据大盘</strong> &nbsp;·&nbsp;
    <strong>🌐 网络监控</strong> &nbsp;·&nbsp;
    <strong>🚀 一键开机自启</strong> &nbsp;·&nbsp;
    <strong>⚡ 高性能稳定</strong> &nbsp;·&nbsp;
    <strong>🐳 完美适配 Docker</strong> &nbsp;·&nbsp;
    <strong>🎨 现代化 UI 设计</strong> &nbsp;·&nbsp;
  </p>

</div>

## 界面截图

![界面截图](screenshot/1.png)

## 快速开始

```bash
docker run -d \
  --name podux \
  --restart unless-stopped \
  -p 8090:8090 \
  -v ./podux-data:/app/pb_data \
  ghcr.io/derrors/podux:latest
```

启动后访问 `http://localhost:8090`，首次进入会引导创建管理员账号。Docker Compose 和二进制安装方式见 [Docker 安装](docs/deploy/install/docker.md) 与 [二进制安装](docs/deploy/install/binary.md)。

## 版本里程碑

- 2026-03-03: 发布 v0.1.0
- 2026-03-12: 发布 v0.1.1
- 2026-03-14: 发布 v0.1.2
- 2026-03-16: 发布 v0.1.3
- 2026-03-25: 发布 v0.1.4
- 2026-03-26: 发布 v0.1.5
- 2026-03-31: 发布 v0.1.6
- 2026-10-29: 发布 v0.2.0（本分支首个版本）
- 2026-10-29: 发布 v0.2.1

完整更新内容见 [Releases](https://github.com/Derrors/podux/releases)。

## License

[Apache 2.0](LICENSE)

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=Derrors/podux&type=Date)](https://www.star-history.com/#Derrors/podux&Date)

<!-- MARKDOWN LINKS & IMAGES -->

[forks-shield]: https://img.shields.io/github/forks/Derrors/podux.svg?style=for-the-badge
[forks-url]: https://github.com/Derrors/podux/network/members
[stars-shield]: https://img.shields.io/github/stars/Derrors/podux.svg?style=for-the-badge
[stars-url]: https://github.com/Derrors/podux/stargazers
[issues-shield]: https://img.shields.io/github/issues/Derrors/podux.svg?style=for-the-badge
[issues-url]: https://github.com/Derrors/podux/issues
[license-shield]: https://img.shields.io/github/license/Derrors/podux.svg?style=for-the-badge
[license-url]: https://github.com/Derrors/podux/blob/main/LICENSE
