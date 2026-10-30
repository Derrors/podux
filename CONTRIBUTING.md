# 参与贡献

<div align="right">
  <b>简体中文</b> | <a href="CONTRIBUTING_en.md">English</a>
</div>

欢迎通过 [Issues](https://github.com/Derrors/podux/issues) 反馈问题或提出建议，也欢迎提交 Pull Request。

## 反馈问题

请附上 Podux 版本、部署方式（Docker / 二进制）、frps 版本、相关日志和复现步骤。日志里的 token、证书等敏感信息请先打码。

## 从源码构建

环境要求：Go 1.27、Node.js 22、pnpm 10。

```bash
git clone https://github.com/Derrors/podux.git && cd podux

# 构建前端，并复制到 pb_public（Go 通过 go:embed 打包进二进制）
pnpm --dir site install --frozen-lockfile
pnpm --dir site run build
rm -rf pb_public && mkdir -p pb_public && cp -R site/dist/. pb_public/

# 构建并运行
go build -o podux .
./podux serve --http 0.0.0.0:8090
```

- **本地开发**：`go run . serve` 启动后端，`pnpm --dir site run dev` 启动前端开发服务器（会把 `/api` 代理到 `127.0.0.1:8090`）。后端启动前 `pb_public/index.html` 需要已存在，可先按上面的步骤构建一次前端
- **文档站**：`pnpm --dir docs install --frozen-lockfile && pnpm --dir docs run docs:dev`
- **多平台打包**：`build/build.sh --arch all`（`--help` 查看全部选项）
- **Docker 镜像**：`docker compose -f deploy/docker-compose.build.yml up -d --build`

## 目录结构

| 目录 | 内容 |
| --- | --- |
| `main.go` | 启动入口与依赖装配 |
| `internal/` | 后端：领域模型、应用服务（frpc、监控、导入等）、持久化、HTTP 接口 |
| `migrations/` | PocketBase 数据库结构迁移 |
| `site/` | 前端（React 19 + TypeScript + Vite + Radix Themes + Tailwind CSS） |
| `docs/` | 使用文档（VitePress） |
| `development/` | [架构](development/architecture.md)、[数据库](development/database-design.md)与 [UI](development/ui-spec.md) 设计文档 |

## 开发约定

提交代码前请阅读 [AGENT.md](AGENT.md)，其中包括分层约定、迁移规则、国际化、UI 规范和安全边界。要点：

- 数据库结构变更必须新增 `migrations/*.go` 迁移，不要直接修改数据库
- 界面文字同时更新 `site/src/locales/zh.json` 和 `en.json`
- 接口、数据结构或认证规则变更时，同步更新 `development/` 下的设计文档
- 用户可见的行为变化，同步更新 `docs/` 下的中英文文档

## 提交前检查

```bash
pnpm --dir site install --frozen-lockfile
pnpm --dir site run lint
pnpm --dir site run build
pnpm --dir docs install --frozen-lockfile
pnpm --dir docs run docs:build

# go:embed 需要 pb_public 已存在
rm -rf pb_public && mkdir -p pb_public && cp -R site/dist/. pb_public/
go vet ./...
go test ./...
go build ./...
```

不要提交 `pb_data/`、`pb_public/`、`site/dist/`、构建产物，以及任何 token、证书或用户数据。
