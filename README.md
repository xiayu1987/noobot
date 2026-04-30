# Noobot

[中文](./README.zh-CN.md) | English

![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-blue)

Noobot is a full-stack AI chat system built with **Node.js + Vue**.

## Features

- Multi-user isolated workspace/session
- Agent tools + skill extension
- SSE streaming output
- One-command deployment via `start.sh` (PM2 + Caddy)

## Project Structure

```text
noobot/
├── service/                  # Node.js backend (Agent/session/tools/memory)
├── client/noobot-chat/       # Vue frontend (Vite)
│   └── deploy/               # Caddy config and scripts
├── start.sh                  # one-command startup/deploy script
└── README.md
```

## Quick Start

```bash
git clone https://github.com/xiayu1987/noobot.git
cd noobot

cp service/config/global.config.example.json service/config/global.config.json
cp user-template/default-user/config.example.json user-template/default-user/config.json
chmod +x start.sh
./start.sh
```

Default endpoints:

- Frontend: `http://127.0.0.1:10060`
- Backend: `http://127.0.0.1:10061`

## Requirements

- Node.js 18+ (recommended 20+)
- npm 9+
- Linux/macOS

Optional system deps:

- `libreoffice`
- `ffmpeg`

## Config

- Main config doc: [`CONFIGURATION.md`](./CONFIGURATION.md)
- Contributing guide: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Backend doc: [`service/README.md`](./service/README.md)

Environment variables for `start.sh`:

- `CADDY_ADDR` (default `:10060`)
- `API_UPSTREAM` (default `127.0.0.1:10061`)

Example:

```bash
CADDY_ADDR=:8080 API_UPSTREAM=127.0.0.1:3001 ./start.sh
```

## PM2 (local)

```bash
cd service
npm run pm2:list
npm run pm2:logs
npm run pm2:stop
npm run pm2:delete
```

## License

[MIT](./LICENSE)
