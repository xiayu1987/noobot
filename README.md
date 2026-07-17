# Noobot

[中文](./README.zh-CN.md) | English

![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-blue)

Noobot is a full-stack AI chat system built with **Node.js + Vue**.

Co-creators: Hyler · Epicur · gonglei · Z · Y · C

## Features

- Multi-user isolated workspace/session
- Agent tools + skill extension
- SSE streaming output + WebSocket long connection
- Agent proxy gateway for resilient WebSocket fanout/replay
- Semantic workflow engine and workflow/harness plugins
- Shared runtime-event logging, sanitization, thresholds, and i18n packages
- Web, startup, Windows, and macOS clients
- One-command deployment via `start.sh` (PM2 + Caddy)
- Connector support (database/terminal/email)
- MCP server integration
- Multi-model provider management with scenario-based routing

## Project Structure

```text
noobot/
├── agent/                    # Agent core (tools, context, execution flow)
├── service/                  # Node.js backend (Express 5 + WebSocket + LangChain)
├── agent-proxy/              # Agent proxy gateway (WebSocket fanout, replay, HTTP proxy)
├── model-proxy/              # Model proxy layer
├── workflow/                 # Semantic workflow engine
├── plugin/
│   ├── noobot-plugin-harness/  # Harness execution plugin
│   └── noobot-plugin-workflow/ # Workflow integration plugin
├── runtime-events/           # Structured startup/session/system event library
├── sanitize/                 # Shared output and sensitive-data sanitization
├── shared/                   # Shared thresholds and runtime configuration
├── i18n/                     # Shared i18n package
├── client/
│   ├── noobot-chat/          # Vue 3 web client (Vite)
│   ├── startup/              # Startup UI
│   ├── windows/              # Windows Electron packaging
│   ├── mac/                  # macOS Electron packaging
│   └── shared/               # Client-side shared code
├── scripts/                  # Release, launcher, and repository checks
├── docs/                     # Architecture / refactor docs
├── user-template/            # User workspace template
├── workspace/                # Local runtime user data (not source code)
├── start.sh                  # one-command startup/deploy script
├── close.sh                  # stop the local PM2 stack
└── README.md
```

## Quick Start

```bash
git clone https://github.com/xiayu1987/noobot.git
cd noobot

chmod +x start.sh
./start.sh
```

Notes:
- `start.sh` runs the project launcher first (`scripts/project-launcher.mjs`).
- If `service/config/global.config.json` does not exist, an interactive setup wizard will create it.
- For non-interactive environments, initialize with env vars (example):

```bash
NOOBOT_MODEL_FORMAT=openai_compatible \
NOOBOT_MODEL_NAME=gemini-3-flash \
NOOBOT_MODEL_API_KEY=xxx \
NOOBOT_MODEL_BASE_URL=https://example.com/v1 \
./start.sh
```

Optional: `NOOBOT_SETUP_LANG=zh|en` (controls setup wizard language and synchronizes `preferences.language` plus built-in config copy text localization).

Default endpoints:

- Frontend: `http://127.0.0.1:10060`
- Backend: `http://127.0.0.1:10061`
- Agent Proxy: `http://127.0.0.1:10062`
- Model Proxy (DashScope): `http://127.0.0.1:12341` -> `https://dashscope.aliyuncs.com`
- Model Proxy (Poe): `http://127.0.0.1:12342` -> `https://api.poe.com`

Stop all services:

```bash
chmod +x close.sh
./close.sh
```

## Requirements

- Node.js 18+ (recommended 20+)
- npm 9+
- Linux/macOS

## Workspace Dependency Management

This repo uses npm workspaces at root (`noobot/package.json`).

```bash
cd noobot
npm install --workspaces
```

Useful commands:

```bash
# run all test scripts that exist
npm run test

# development servers
npm run dev:service
npm run dev:agent-proxy
npm run dev:client

# build the startup UI and web client
npm run build
```

The root `package.json` is the source of truth for the current workspace list and
repository-wide scripts. Package-specific scripts can also be run with
`npm run -w <workspace> <script>`.

Optional system deps:

- `libreoffice` (Office document conversion)
- `ffmpeg` (audio/video processing)
- `docker` / `bubblewrap` / `firejail` (script sandbox)

## Desktop Packaging

Install dependencies first from the repository root:

```bash
npm install --workspaces
```

Then choose one of the following equivalent approaches.

From the repository root (the root scripts already select the workspace with
`-w`):

```bash
# Build the Windows desktop package
npm run build:windows

# Build the macOS desktop package
npm run build:mac
```

Or run the workspace script from the corresponding desktop client directory:

```bash
# Windows (run from client/windows)
cd client/windows
npm run build:win

# macOS (run from client/mac)
cd ../mac
npm run build:mac
```

The commands prepare the frontend, Electron client, and backend before invoking
`electron-builder`. The generated artifacts are written to the corresponding
desktop client's `dist/` directory.

## Config

- Main config doc: [`CONFIGURATION.md`](./CONFIGURATION.md)
- Session log WebSocket, retention, and debug switches are documented in [`CONFIGURATION.md`](./CONFIGURATION.md#2-environment-variables).
- Contributing guide: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Coding standard: [`CODING-STANDARD.md`](./CODING-STANDARD.md)
- Backend docs: [English](./service/README.md) | [中文](./service/README.zh-CN.md)

Environment variables for `start.sh`:

- `CADDY_ADDR` (default `:10060`)
- `API_UPSTREAM` (default `127.0.0.1:10061`)
- `AGENT_PROXY_UPSTREAM` (default `127.0.0.1:10062`)

Example:

```bash
CADDY_ADDR=:8080 API_UPSTREAM=127.0.0.1:3001 AGENT_PROXY_UPSTREAM=127.0.0.1:3002 ./start.sh
```

## PM2 (local)

> The PM2 scripts below manage one package at a time and do not run the project
> initialization launcher. For first-time deployment, dependency installation,
> frontend build, or config auto-sync, use `./start.sh`.

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

## License

[MIT](./LICENSE)
