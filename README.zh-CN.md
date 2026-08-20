# Noobot

**支持工具调用、多模型路由、MCP 与多智能体工作流的自托管 AI Agent 工作空间。**

中文 | [English](./README.md)

[![Release](https://img.shields.io/github/v/release/xiayu1987/noobot)](https://github.com/xiayu1987/noobot/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/xiayu1987/noobot/total)](https://github.com/xiayu1987/noobot/releases)
[![Stars](https://img.shields.io/github/stars/xiayu1987/noobot?style=flat)](https://github.com/xiayu1987/noobot/stargazers)
[![Quality Checks](https://github.com/xiayu1987/noobot/actions/workflows/quality-checks.yml/badge.svg)](https://github.com/xiayu1987/noobot/actions/workflows/quality-checks.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D22.22.2-blue)

[Windows 安装程序](https://github.com/xiayu1987/noobot/releases/latest)（选择 `Noobot.Setup.<版本>.exe`）· [macOS 客户端](https://github.com/xiayu1987/noobot/releases/latest)（选择 `Noobot-<版本>-mac.zip`）· [配置文档](./CONFIGURATION.zh-CN.md) · [参与讨论](https://github.com/xiayu1987/noobot/discussions)

Noobot 是基于 Node.js、Vue 3 和 Electron 构建的开源 Web 与桌面 AI Agent 应用。它在一个自托管部署中提供隔离用户工作区、持久会话、可扩展工具、语义工作流，以及 OpenAI 兼容接口和 DashScope 模型接入。

共创者：Hyler · Epicur · gonglei · Z · Y · C

## Noobot 实际运行效果

全英文虚构股票组合分析演示：Noobot 验证源数据、串联四次文件工具调用、实时展示分析过程，并将结果发布为可复用的报告附件。

![Noobot 使用工具分析虚构股票组合](./docs/assets/noobot-tool-workflow.gif)

<details>
<summary>查看完成后的分析结果</summary>

![Noobot 完成虚构股票组合分析](./docs/assets/noobot-agent-workspace.png)

</details>

## 为什么选择 Noobot

- **Agent 工作空间：** 多用户工作区和会话隔离，支持持久附件与执行历史。
- **工具与技能：** 文件操作、原生/沙箱脚本、浏览器自动化、LibreOffice、FFmpeg、多模态解析与生成、服务和可复用技能。
- **模型互操作：** OpenAI 兼容和 DashScope 接口，按运营商/模型系列路由，支持工具调用、流式响应与多模态能力配置。
- **多智能体编排：** 任务委派、语义工作流、Workflow 插件，以及 Harness 规划/指导/审查。
- **MCP 与连接器：** 支持 MCP Server，以及数据库、终端、邮件和自定义服务连接器。
- **Web 与桌面端：** Vue 3 Web 客户端，以及 Windows 和 macOS Electron 客户端。
- **自托管运维：** PM2 + Caddy 一键部署，提供运行审计、重放、数据清洗和中英文配置。

## 获取 Noobot

| 方式             | 下载或命令                                                                                          | 说明                        |
| ---------------- | --------------------------------------------------------------------------------------------------- | --------------------------- |
| Windows 安装程序 | 进入[最新版本](https://github.com/xiayu1987/noobot/releases/latest)，选择 `Noobot.Setup.<版本>.exe` | Windows 推荐下载方式        |
| Windows 打包归档 | 进入[最新版本](https://github.com/xiayu1987/noobot/releases/latest)，选择 `Noobot-<版本>-win.zip`   | 不使用安装向导的 ZIP 分发包 |
| macOS 打包归档   | 进入[最新版本](https://github.com/xiayu1987/noobot/releases/latest)，选择 `Noobot-<版本>-mac.zip`   | 已打包的 macOS 桌面客户端   |
| 自托管 Web       | [`./start.sh`](#快速开始)                                                                           | Linux 或 macOS 服务器部署   |

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
- 模型代理地址会根据已配置的模型供应商自动生成。

关闭全部服务：

```bash
chmod +x stop-services.sh
./stop-services.sh
```

## 环境要求

- Node.js 22.22.2+
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

# 启动开发服务
npm run dev:service
npm run dev:agent-proxy
npm run dev:client

# 构建启动页与 Web 客户端
npm run build
```

当前 workspace 列表和仓库级命令以根目录 `package.json` 为准。也可以使用
`npm run -w <workspace> <script>` 运行单个 workspace 的脚本。

可选系统依赖：

- `libreoffice`（Office 文档转换）
- `ffmpeg`（音视频处理）
- `docker`（可编程工作区计算沙箱）

## 桌面端打包

先在仓库根目录安装依赖：

```bash
npm install --workspaces
```

然后任选以下一种等效方式执行。

在仓库根目录执行（根脚本内部已经通过 `-w` 指定对应 workspace）：

```bash
# 构建 Windows 桌面安装包
npm run build:windows

# 构建 macOS 桌面安装包
npm run build:mac
```

也可以进入对应桌面客户端目录，直接执行子项目脚本：

```bash
# Windows（在 client/windows 目录执行）
cd client/windows
npm run build:win

# macOS（在 client/mac 目录执行）
cd ../mac
npm run build:mac
```

这两个命令会依次准备前端、Electron 客户端和后端，然后调用
`electron-builder`。生成的文件位于对应桌面客户端的 `dist/` 目录。

## 配置说明

- 核心配置文档：[`CONFIGURATION.zh-CN.md`](./CONFIGURATION.zh-CN.md)
- Session 日志 WebSocket、保留时间和 debug 开关见 [`CONFIGURATION.zh-CN.md`](./CONFIGURATION.zh-CN.md#2环境变量)
- 贡献指南：[`CONTRIBUTING.zh-CN.md`](./CONTRIBUTING.zh-CN.md)
- 编码规范：[`CODING-STANDARD.md`](./CODING-STANDARD.md)
- 后端说明：[中文](./service/README.zh-CN.md) | [English](./service/README.md)

`start.sh` 可用环境变量：

- `CADDY_ADDR`（默认 `:10060`）
- `AGENT_PROXY_UPSTREAM`（默认 `127.0.0.1:10062`）
- `PORT`（service 端口，默认 `10061`）

示例：

```bash
CADDY_ADDR=:8080 PORT=3001 AGENT_PROXY_UPSTREAM=127.0.0.1:3002 \
AGENT_PROXY_PORT=3002 ./start.sh
```

## PM2（项目内）

> 以下 PM2 命令每次只管理一个子项目，不执行项目初始化引导。首次部署、
> 安装依赖、构建前端或需要自动同步配置时，请使用 `./start.sh`。

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
