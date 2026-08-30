# Noobot Service

[中文](./README.zh-CN.md) | English

`service/` is Noobot's Express 5 and WebSocket host. Agent behavior is owned by the separate `noobot-agent` workspace; the Service owns HTTP/WS admission, authentication, configuration delivery, workspace access, and Service plugin capabilities.

## Requirements

- Node.js 22.22.2+
- npm 9+
- Optional: LibreOffice, FFmpeg, Docker, and OpenVSCode Server dependencies used by enabled capabilities

## Run And Test

```bash
cd service
npm install
npm start

# development
npm run dev

# tests
npm test
npm run test:routes
npm run test:tools
```

Project-local PM2 commands:

```bash
npm run pm2:start
npm run pm2:restart
npm run pm2:logs
npm run pm2:stop
```

For the complete deployment, use `./start.sh` or `./restart-services.sh` from the repository root.

## Configuration

- Global config: `service/config/global.config.json`
- Global template: `service/config/global.config.example.json`
- User config: `workspace/<userId>/config.json`
- System parameters: `workspace/config-params.json`
- User parameters: `workspace/<userId>/config-params.json`
- Environment file: `service/.env`

See [Configuration](../CONFIGURATION.md) for the authoritative fields and precedence rules.

## Authentication

- `GET /health` and `POST /internal/connect` do not require an API key.
- Other Service routes require the issued API key unless their registered plugin route declares another validated policy.
- `POST /internal/connect` exchanges `userId + connectCode` for connection data and an API key.
- Authenticated requests accept `x-api-key`, `Authorization: Bearer <apiKey>`, or `?apikey=...`.
- `/internal/admin/*` additionally requires the configured super-admin role.

## Main API Groups

- Chat and transport: `POST /chat`, `WS /chat/ws`, `WS /logs/ws`
- Sessions: `/internal/sessions/:userId`, `/internal/session/:userId/:sessionId`
- Session mutations: `messages/delete-from`, `messages/replace-turn`, `rename`
- Attachments: `/internal/attachment/:userId/:attachmentId` with complete Session/source identity in the query
- Connectors: catalog, user instances, connect/disconnect, Session selection
- User workspace: `/internal/workspace/:userId`, reset, and sync
- Admin: users, template, config parameters, and all-workspace operations
- Plugins: manifest-derived Service routes bound through the scoped plugin host

The route modules under `routes/` and plugin manifests are the source of truth for exact methods and paths.

## Directory Ownership

```text
service/
├── app.js                 process entry and composition root
├── bootstrap/             dependency creation, middleware, routes, server start
├── config/                global configuration files
├── deps/                  Service-side dependency adapters
├── routes/                HTTP route modules
├── security/              HTTP admission and security policy
├── services/              Service-owned application services and plugin host
├── ws/                    chat and log WebSocket servers
└── scripts/               Service utilities
```

Agent execution, tools, Context, Session domain logic, model resolution, and memory live in `../agent/`. Provider adaptation and model execution live in `../model-runtime/`; Service code must not duplicate those responsibilities.
