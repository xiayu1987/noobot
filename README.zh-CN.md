# Noobot

中文 | [English](./README.md)

![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-blue)

Noobot 是一个基于 **Node.js + Vue** 的前后端分离智能对话系统。

## 功能特性

- 多用户隔离工作区与会话
- Agent 工具调用与技能扩展
- SSE 流式输出
- `start.sh` 一键部署（PM2 + Caddy）

## 项目结构

```text
noobot/
├── service/                  # Node.js 后端（Agent/会话/工具/记忆）
├── client/noobot-chat/       # Vue 前端（Vite）
│   └── deploy/               # Caddy 配置与脚本
├── start.sh                  # 一键启动/部署脚本
└── README.md
```

## 快速开始

```bash
git clone https://github.com/xiayu1987/noobot.git
cd noobot

cp service/config/global.config.example.json service/config/global.config.json
cp user-template/default-user/config.example.json user-template/default-user/config.json
chmod +x start.sh
./start.sh
```

默认地址：

- 前端：`http://127.0.0.1:10060`
- 后端：`http://127.0.0.1:10061`

## 环境要求

- Node.js 18+（推荐 20+）
- npm 9+
- Linux/macOS

可选系统依赖：

- `libreoffice`
- `ffmpeg`

## 配置说明

- 核心配置文档：[`CONFIGURATION.zh-CN.md`](./CONFIGURATION.zh-CN.md)
- 贡献指南：[`CONTRIBUTING.zh-CN.md`](./CONTRIBUTING.zh-CN.md)
- 后端说明：[`service/README.md`](./service/README.md)

`start.sh` 可用环境变量：

- `CADDY_ADDR`（默认 `:10060`）
- `API_UPSTREAM`（默认 `127.0.0.1:10061`）

示例：

```bash
CADDY_ADDR=:8080 API_UPSTREAM=127.0.0.1:3001 ./start.sh
```

## PM2（项目内）

```bash
cd service
npm run pm2:list
npm run pm2:logs
npm run pm2:stop
npm run pm2:delete
```

## 开源协议

[MIT](./LICENSE)
