# Noobot

[中文](./README.zh-CN.md) | English

![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-blue)

Noobot is a full-stack AI chat system built with **Node.js + Vue**.

## Features

- Multi-user isolated workspace/session
- Agent tools + skill extension
- SSE streaming output + WebSocket long connection
- Agent proxy gateway for resilient WebSocket fanout/replay
- One-command deployment via `start.sh` (PM2 + Caddy)
- Connector support (database/terminal/email)
- MCP server integration
- Multi-model provider management with scenario-based routing

## Project Structure

```text
noobot/
├── service/                  # Node.js backend (Express 5 + WebSocket + LangChain)
├── agent-proxy/              # Agent proxy gateway (WebSocket fanout, replay, HTTP proxy)
├── model-proxy/              # Model proxy layer
├── client/noobot-chat/       # Vue 3 frontend (Vite)
├── user-template/            # User workspace template
├── workspace/                # Runtime user data (sessions, files, attachments, config params)
├── start.sh                  # one-command startup/deploy script
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
- `start.sh` runs the project launcher first (`service/scripts/project-launcher.js`).
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

# run a script in one workspace
npm run -w service dev
npm run -w client/noobot-chat build
```

Optional system deps:

- `libreoffice` (Office document conversion)
- `ffmpeg` (audio/video processing)
- `docker` / `bubblewrap` / `firejail` (script sandbox)

## Config

- Main config doc: [`CONFIGURATION.md`](./CONFIGURATION.md)
- Contributing guide: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Coding standard: [`CODING-STANDARD.md`](./CODING-STANDARD.md)
- Backend docs: [English](./service/README.md) | [中文](./service/README.zh-CN.md)

Environment variables for `start.sh`:

- `CADDY_ADDR` (default `:10060`)
- `API_UPSTREAM` (default `127.0.0.1:10061`)

Example:

```bash
CADDY_ADDR=:8080 API_UPSTREAM=127.0.0.1:3001 ./start.sh
```

## PM2 (local)

> Note: `npm run pm2:start` only starts the backend service and does not run the project initialization launcher.  
> For first-time deployment or config auto-sync, use `./start.sh` first.

```bash
cd service
npm run pm2:list
npm run pm2:logs
npm run pm2:stop
npm run pm2:delete
```

## License

[MIT](./LICENSE)
