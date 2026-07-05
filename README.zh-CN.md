# Noobot

中文 | [English](./README.md)

![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-blue)

Noobot 是一个基于 **Node.js + Vue** 的前后端分离智能对话系统。

共创者：Hyler · Epicur · gonglei · Z · Y · C

## 功能特性

- 多用户隔离工作区与会话
- Agent 工具调用与技能扩展
- SSE 流式输出 + WebSocket 长连接
- Agent 代理网关（WebSocket 扇出/重放/HTTP 代理）
- `start.sh` 一键部署（PM2 + Caddy）
- 连接器支持（数据库/终端/邮件）
- MCP 服务集成
- 多模型提供方管理与情景路由

## 项目结构

```text
noobot/
├── agent/                    # Agent 核心（工具、上下文、执行流）
├── service/                  # Node.js 后端（Express 5 + WebSocket + LangChain）
├── agent-proxy/              # Agent 代理网关（WebSocket 扇出、消息重放、HTTP 代理）
├── model-proxy/              # 模型代理层
├── plugin/                   # 内置插件（如 harness）
├── i18n/                     # 共享 i18n 包
├── client/noobot-chat/       # Vue 3 前端（Vite）
├── docs/                     # 架构/重构文档
├── user-template/            # 用户工作区模板
├── workspace/                # 运行时用户数据（会话、文件、附件、配置参数）
├── start.sh                  # 一键启动/部署脚本
└── README.md
```

## 快速开始

```bash
git clone https://github.com/xiayu1987/noobot.git
cd noobot

chmod +x start.sh
./start.sh
```

说明：
- `start.sh` 会先执行项目启动引导（`scripts/project-launcher.mjs`）。
- 若 `service/config/global.config.json` 不存在，会进入交互式配置并自动生成配置文件。
- 在非交互环境可用环境变量初始化（示例）：

```bash
NOOBOT_MODEL_FORMAT=openai_compatible \
NOOBOT_MODEL_NAME=gemini-3-flash \
NOOBOT_MODEL_API_KEY=xxx \
NOOBOT_MODEL_BASE_URL=https://example.com/v1 \
./start.sh
```

可选：`NOOBOT_SETUP_LANG=zh|en`（初始化引导语言，并同步 `preferences.language` 与配置内置文案的中英文文本）。

默认地址：

- 前端：`http://127.0.0.1:10060`
- 后端：`http://127.0.0.1:10061`
- Agent 代理：`http://127.0.0.1:10062`
- 模型代理（DashScope）：`http://127.0.0.1:12341` -> `https://dashscope.aliyuncs.com`
- 模型代理（Poe）：`http://127.0.0.1:12342` -> `https://api.poe.com`

关闭全部服务：

```bash
chmod +x close.sh
./close.sh
```

## 环境要求

- Node.js 18+（推荐 20+）
- npm 9+
- Linux/macOS

## Workspace 依赖管理

仓库根目录（`noobot/package.json`）已启用 npm workspaces。

```bash
cd noobot
npm install --workspaces
```

常用命令：

```bash
# 运行所有存在 test 脚本的子项目
npm run test

# 只运行某个子项目脚本
npm run -w service dev
npm run -w client/noobot-chat build
```

可选系统依赖：

- `libreoffice`（Office 文档转换）
- `ffmpeg`（音视频处理）
- `docker` / `bubblewrap` / `firejail`（脚本沙箱）

## 配置说明

- 核心配置文档：[`CONFIGURATION.zh-CN.md`](./CONFIGURATION.zh-CN.md)
- Session 日志 WebSocket、保留时间和 debug 开关见 [`CONFIGURATION.zh-CN.md`](./CONFIGURATION.zh-CN.md#2环境变量)
- 贡献指南：[`CONTRIBUTING.zh-CN.md`](./CONTRIBUTING.zh-CN.md)
- 编码规范：[`CODING-STANDARD.md`](./CODING-STANDARD.md)
- 后端说明：[中文](./service/README.zh-CN.md) | [English](./service/README.md)

`start.sh` 可用环境变量：

- `CADDY_ADDR`（默认 `:10060`）
- `API_UPSTREAM`（默认 `127.0.0.1:10061`）
- `AGENT_PROXY_UPSTREAM`（默认 `127.0.0.1:10062`）

示例：

```bash
CADDY_ADDR=:8080 API_UPSTREAM=127.0.0.1:3001 AGENT_PROXY_UPSTREAM=127.0.0.1:3002 ./start.sh
```

## PM2（项目内）

> 注意：`npm run pm2:start` 仅启动后端服务，不包含项目初始化引导。  
> 首次部署或需要自动配置同步时，请优先使用 `./start.sh`。

```bash
cd service && npm run pm2:list
cd service && npm run pm2:logs
cd service && npm run pm2:stop
cd service && npm run pm2:delete

cd agent-proxy && npm run pm2:list
cd agent-proxy && npm run pm2:logs
cd agent-proxy && npm run pm2:stop
cd agent-proxy && npm run pm2:delete

cd model-proxy && npm run pm2:list
cd model-proxy && npm run pm2:logs
cd model-proxy && npm run pm2:stop
cd model-proxy && npm run pm2:delete
```

## 开源协议

[MIT](./LICENSE)
