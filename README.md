# noobot

一个前后端分离的 Node.js + Vue 项目，包含 Agent 后端、聊天前端和一键部署脚本。

> 免责声明：本项目主要用于学习与研究，请勿直接用于生产环境；如用于生产，风险与合规责任由使用者自行承担。
>
> 安全提示：建议优先在隔离沙箱环境（如 Docker / 独立测试机）中安装和运行。

## 项目结构

- `service/`：Node.js 后端（Agent、会话、记忆、工具调用）
- `client/noobot-chat/`：Vue 前端（Vite 构建）
- `client/noobot-chat/deploy/`：Caddy 配置与启动脚本
- `start.sh`：一键更新/安装/构建/重建 PM2 并启动服务

## 架构说明

### 1) 整体架构（简图）

```text
Browser
  -> Caddy (静态资源 + /api 反代)
  -> service (Express + Agent Runtime)
  -> Model / Tools / Workspace(会话与记忆)
```

### 2) 请求链路

1. 浏览器访问前端页面（由 Caddy 提供 `dist` 静态文件）
2. 前端请求 `/api/*`，由 Caddy 反代到 `API_UPSTREAM`（默认 `127.0.0.1:10061`）
3. 后端处理会话、上下文、记忆和工具调用
4. 结果以普通响应或 SSE 流式返回给前端

### 3) 运行与进程

- `start.sh` 统一执行：更新代码 → 安装依赖 → 构建前端 → 重建 PM2 进程
- PM2 托管两个进程：
  - `noobot-service`（后端）
  - `noobot-client`（`serve:caddy`）
- PM2 数据目录固定为项目内 `.pm2/`（避免污染系统默认 `~/.pm2`）


> 详细实现可查看：`service/README.md`

## 功能概览

- 多用户工作区隔离（按用户目录独立存储）
- 会话管理（新建会话 / 续聊 / 会话历史）
- 长短期记忆机制（会话记忆沉淀）
- 技能机制（可扩展技能目录与任务流程）
- 技能体系兼容 OpenClaw（可复用/迁移 OpenClaw 风格技能）
- 工具调用能力（文件读写、脚本执行、文档解析等）
- SSE 流式输出（前端实时查看生成过程）
- 前后端一键启动（`start.sh`：更新、安装、构建、重建 PM2）
- 前端通过 Caddy 提供静态服务并反代后端 API
- PM2 项目内托管（`PM2_HOME=.pm2`，减少系统环境污染）

## 环境要求

- Node.js 18+（建议 20+）
- npm 9+
- Linux/macOS（`run-caddy.sh` 可自动下载 caddy）

## 快速开始

```bash
git clone <your-repo-url>
cd noobot
cp service/config/global.config.example.json service/config/global.config.json 创建配置文件
# 编辑 service/config/global.config.json，配置你要使用的模型与 API Key
chmod +x start.sh
./start.sh
```

> ⚠️ 首次运行前请先修改 `service/config/global.config.json`：
>
> - 选择默认模型：`defaultProvider`
> - 配置对应 provider（如 `qwen3_5_flash` / `openai`）的 `api_key`、`base_url`、`model`
> - 至少确保你启用的 provider（`enabled: true`）已填写可用的密钥

默认行为：

1. 更新代码（有 upstream 时 `git pull --rebase`）
2. 安装依赖（client + service）
3. 构建前端
4. 重建 PM2 进程并启动：
   - `noobot-service`
   - `noobot-client`（`npm run serve:caddy`）

启动完成后会输出：

- 前端访问地址（默认 `http://127.0.0.1:10060`）
- 后端 API 反代地址（默认 `http://127.0.0.1:10061`）

## 常用配置

### 1) 根脚本环境变量（`start.sh`）

- `CADDY_ADDR`：前端监听地址，默认 `:10060`
- `API_UPSTREAM`：前端反代目标，默认 `127.0.0.1:10061`

示例：

```bash
CADDY_ADDR=:8080 API_UPSTREAM=127.0.0.1:3001 ./start.sh
```

### 2) 后端端口

后端读取 `service/.env`，可参考 `service/.env.example`：

```bash
PORT=10061
```

## PM2（项目内托管）

项目使用 `PM2_HOME=.pm2`，避免污染系统默认 `~/.pm2`。

可在 `service/` 下使用：

```bash
npm run pm2:list
npm run pm2:logs
npm run pm2:stop
npm run pm2:delete
```

## 常见问题

### 1) `npx pm2 list` 看不到进程

请使用项目内脚本（已带 `PM2_HOME`）：

```bash
cd service
npm run pm2:list
```

### 2) 前端 caddy 二进制在哪里

默认下载到：

`client/noobot-chat/deploy/bin/caddy`

### 3) 报错 `Client sent an HTTP request to an HTTPS server`

请确认通过 `http://` 访问，且 Caddyfile 使用 `http://{$CADDY_ADDR...}`。

## 开源协议

本项目使用 [MIT License](./LICENSE)。

## Maintainer Contact

- 126240622+xiayu1987@users.noreply.github.com
