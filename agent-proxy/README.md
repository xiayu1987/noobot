# Agent Proxy

[中文](./README.zh-CN.md) | English

Noobot agent proxy gateway — a lightweight WebSocket fanout/replay and HTTP proxy layer sitting between the frontend and the Noobot backend service.

## Purpose

- **WebSocket fanout** — one upstream WebSocket connection to the backend serves multiple frontend clients for the same session.
- **Message replay** — events are buffered per channel; reconnecting clients receive missed events automatically.
- **HTTP proxy** — forwards HTTP requests to the backend with transparent routing.
- **Resilience** — handles upstream disconnects, channel lifecycle, and automatic cleanup.

## Architecture

```
Frontend  ──WS/HTTP──►  Agent Proxy (10062)  ──WS/HTTP──►  Noobot Service (10061)
```

### Key Concepts

| Concept | Description |
|---|---|
| **Channel** | A logical session identified by `userId::sessionId::parentSessionId::dialogProcessId`. Each channel has one upstream WebSocket to the backend and zero or more downstream subscriber sockets. |
| **Event Log** | Ordered event buffer per channel (configurable max size). Used for replay on reconnect. |
| **Subscriber** | A frontend WebSocket attached to a channel. Receives broadcast events and can send messages upstream. |
| **Upstream Socket** | Single WebSocket from the proxy to the Noobot backend per active channel. |

### Message Flow

1. Client sends `start_or_join` action with `userId` + `sessionId`.
2. Proxy resolves or creates a channel, attaches the client as a subscriber.
3. If no upstream exists, proxy opens one to the backend and forwards the start payload.
4. Backend events are captured, sequenced, logged, and broadcast to all subscribers.
5. On reconnect, client sends `reconnect` with `lastReceivedSeqMap`; proxy replays missing events.

## Configuration

All settings are via environment variables:

| Variable | Default | Description |
|---|---|---|
| `AGENT_PROXY_PORT` | `10062` | Proxy listen port |
| `AGENT_PROXY_HOST` | `0.0.0.0` | Proxy listen host |
| `AGENT_PROXY_UPSTREAM_WS_URL` | `ws://127.0.0.1:10061/chat/ws` | Backend WebSocket URL |
| `AGENT_PROXY_UPSTREAM_HTTP_BASE` | `http://127.0.0.1:10061` | Backend HTTP base URL |
| `AGENT_PROXY_CHANNEL_RETENTION_MS` | `600000` (10 min) | Terminal channel retention |
| `AGENT_PROXY_API_KEY_RETENTION_MS` | `86400000` (24 h) | API key identity retention |
| `AGENT_PROXY_MAX_CHANNEL_EVENTS` | `2000` | Max events buffered per channel |
| `AGENT_PROXY_CLEANUP_INTERVAL_MS` | `15000` | Cleanup timer interval |
| `AGENT_PROXY_MAX_CONNECTIONS` | `1000` | Max concurrent WebSocket connections |
| `AGENT_PROXY_MAX_BODY_SIZE` | `10485760` (10 MB) | Max HTTP request body size |
| `AGENT_PROXY_REQUEST_ID_TTL_MS` | `660000` (11 min) | Interaction request ID TTL |
| `AGENT_PROXY_HTTP_UPSTREAM_TIMEOUT_MS` | `30000` | HTTP upstream timeout |
| `AGENT_PROXY_REPLAY_ON_RECONNECT` | `false` | Enable replay on reconnect |
| `AGENT_PROXY_MAX_REPLAY_EVENTS` | `5000` | Max events per replay |

## Quick Start

```bash
cd agent-proxy
npm install
npm start
```

Or with custom upstream:

```bash
AGENT_PROXY_UPSTREAM_WS_URL=ws://192.168.1.100:10061/chat/ws npm start
```

## PM2

```bash
npm run pm2:start
npm run pm2:restart
npm run pm2:stop
npm run pm2:delete
npm run pm2:logs
npm run pm2:list
```

## Endpoints

| Path | Protocol | Description |
|---|---|---|
| `/health` | HTTP | Health check (returns channel count, active connections) |
| `/chat/ws`, `/api/chat/ws`, `/agent-proxy/ws`, `/api/agent-proxy/ws` | WebSocket | Client WebSocket connections |
| `/internal/connect`, `/api/internal/connect` | HTTP | Connect interceptor |
| *any other* | HTTP | Proxied to backend |

## License

[MIT](../LICENSE)
