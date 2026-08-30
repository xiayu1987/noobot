# Agent Proxy

[中文](./README.zh-CN.md) | English

Noobot Agent Proxy is the HTTP and WebSocket gateway between clients and the Noobot Service. It owns connection fanout, channel access control, reconnect authority synchronization, transport delivery, rate limiting, and optional frontend hosting. It does not own Agent business state.

## Architecture

```text
Client  -- HTTP/WebSocket -->  Agent Proxy :10062  -- HTTP/WebSocket -->  Service :10061
```

One channel is identified by `userId + sessionId + parentSessionId + parentDialogProcessId`. A channel can have multiple downstream subscribers and one active upstream connection.

## Transport behavior

- Agent commands use `@noobot/agent-transport-protocol`; send, resend, continue, stop, finalize, interaction response, and snapshot/query commands are routed by command type.
- Backend protocol events are validated, sequenced, and broadcast without changing their business identity.
- Turn lifecycle delivery uses receipts and bounded redelivery.
- A reconnect request carries `currentSessionId`, `requestId`, and `knownLifecycleSequenceMap`.
- Reconnect returns one authoritative `replayBatch` per session. A batch can contain a Turn snapshot, the contiguous lifecycle tail after that snapshot, and complete unresolved `pendingInteractions` events.
- Message cursors and payload fragments are not reconnect authority; reconnect accepts only the lifecycle sequence map defined above.

The reconnect wire shapes are owned by `@noobot/event-protocol`, `@noobot/session-protocol`, and `@noobot/agent-transport-protocol`; this package only coordinates their transport.

## Configuration

Configuration is read from `agent-proxy.config.json`, with environment variables taking precedence. The complete supported key list, defaults, normalization, and environment-variable mapping are defined only in `src/shared/config.js`.

Core settings:

| Environment variable                               | Default                        | Purpose                                                   |
| -------------------------------------------------- | ------------------------------ | --------------------------------------------------------- |
| `AGENT_PROXY_PORT`                                 | `10062`                        | Listen port                                               |
| `AGENT_PROXY_HOST`                                 | `0.0.0.0`                      | Listen host                                               |
| `AGENT_PROXY_UPSTREAM_WS_URL`                      | `ws://127.0.0.1:10061/chat/ws` | Service WebSocket endpoint                                |
| `AGENT_PROXY_UPSTREAM_HTTP_BASE`                   | `http://127.0.0.1:10061`       | Service HTTP base URL                                     |
| `AGENT_PROXY_HTTP_UPSTREAM_TIMEOUT_MS`             | `60000`                        | Upstream HTTP timeout                                     |
| `AGENT_PROXY_RECONNECT_SNAPSHOT_TIMEOUT_MS`        | shared time threshold          | Reconnect snapshot timeout                                |
| `AGENT_PROXY_TURN_LIFECYCLE_RECEIPT_TIMEOUT_MS`    | shared time threshold          | Lifecycle receipt timeout                                 |
| `AGENT_PROXY_TURN_LIFECYCLE_DELIVERY_MAX_ATTEMPTS` | shared turn threshold          | Lifecycle delivery attempt limit                          |
| `AGENT_PROXY_WS_MAX_PAYLOAD_BYTES`                 | shared length threshold        | Maximum incoming WebSocket payload                        |
| `AGENT_PROXY_WS_MAX_BUFFERED_BYTES`                | shared length threshold        | Maximum buffered WebSocket output                         |
| `AGENT_PROXY_TRUSTED_ORIGINS`                      | empty                          | Comma-separated allowed origins; empty allows any origin  |
| `AGENT_PROXY_TRUSTED_IPS`                          | empty                          | Comma-separated allowed IP patterns; empty allows any IP  |
| `AGENT_PROXY_CONNECT_TOKEN`                        | empty                          | Token required by the connect interceptor when configured |
| `AGENT_PROXY_HTTP_RATE_LIMIT_ENABLED`              | `true`                         | Enable HTTP rate limiting                                 |
| `AGENT_PROXY_WS_RATE_LIMIT_ENABLED`                | `true`                         | Enable WebSocket upgrade rate limiting                    |
| `AGENT_PROXY_FRONTEND_ROOT`                        | empty                          | Optional built frontend directory                         |

Do not duplicate the full configuration schema in deployment documentation. Use `src/shared/config.js` when adding or changing a setting.

## Run and test

```bash
cd agent-proxy
npm install
npm start
npm test
```

PM2 commands:

```bash
npm run pm2:start
npm run pm2:restart
npm run pm2:stop
npm run pm2:delete
npm run pm2:logs
npm run pm2:list
```

## Endpoints

| Path                                                                 | Protocol             | Purpose                                             |
| -------------------------------------------------------------------- | -------------------- | --------------------------------------------------- |
| `/health`                                                            | HTTP                 | Health and active-connection summary                |
| `/chat/ws`, `/api/chat/ws`, `/agent-proxy/ws`, `/api/agent-proxy/ws` | WebSocket            | Agent transport                                     |
| `/logs/ws`, `/api/logs/ws`                                           | WebSocket proxy      | Runtime log stream                                  |
| `/internal/connect`, `/api/internal/connect`                         | HTTP                 | Authenticated connect interceptor                   |
| `/ide`, `/ide/*`                                                     | HTTP/WebSocket proxy | IDE route                                           |
| Other HTTP paths                                                     | HTTP proxy           | Forwarded to Service; `/api` is stripped by default |

When `AGENT_PROXY_FRONTEND_ROOT` points to a built frontend, non-API GET/HEAD routes are served as an SPA.

## License

[MIT](../LICENSE)
