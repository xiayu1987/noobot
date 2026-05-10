# Noobot

中文 | [English](./README.md)

![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-blue)

Noobot 是一个基于 **Node.js + Vue** 的前后端分离智能对话系统。

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
├── service/                  # Node.js 后端（Express 5 + WebSocket + LangChain）
├── agent-proxy/              # Agent 代理网关（WebSocket 扇出、消息重放、HTTP 代理）
├── model-proxy/              # 模型代理层
├── client/noobot-chat/       # Vue 3 前端（Vite）
├── user-template/            # 用户工作区模板
├── workspace/                # 运行时用户数据（会话、文件、附件、配置参数）
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
- Agent 代理：`http://127.0.0.1:10062`

## 环境要求

- Node.js 18+（推荐 20+）
- npm 9+
- Linux/macOS

可选系统依赖：

- `libreoffice`（Office 文档转换）
- `ffmpeg`（音视频处理）
- `docker` / `bubblewrap` / `firejail`（脚本沙箱）

## 配置说明

- 核心配置文档：[`CONFIGURATION.zh-CN.md`](./CONFIGURATION.zh-CN.md)
- 贡献指南：[`CONTRIBUTING.zh-CN.md`](./CONTRIBUTING.zh-CN.md)
- 编码规范：[`CODING-STANDARD.md`](./CODING-STANDARD.md)
- 后端说明：[中文](./service/README.zh-CN.md) | [English](./service/README.md)

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
