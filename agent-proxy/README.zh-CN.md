# Agent Proxy

中文 | [English](./README.md)

Noobot Agent 代理网关 — 一个轻量级的 WebSocket 扇出/重放与 HTTP 代理层，位于前端与 Noobot 后端服务之间。

## 作用

- **WebSocket 扇出** — 一条到后端的 WebSocket 上行连接，服务同一会话的多个前端客户端。
- **消息重放** — 每个频道（channel）的事件会被缓冲；客户端重连时自动补发缺失事件。
- **HTTP 代理** — 透明转发 HTTP 请求到后端。
- **高可用** — 处理上行断开、频道生命周期管理与自动清理。

## 架构

```
前端  ──WS/HTTP──►  Agent Proxy (10062)  ──WS/HTTP──►  Noobot Service (10061)
```

### 核心概念

| 概念 | 说明 |
|---|---|
| **频道（Channel）** | 逻辑会话，由 `userId::sessionId::parentSessionId::dialogProcessId` 唯一标识。每个频道有一条到后端的上行 WebSocket 和零个或多个下游订阅者。 |
| **事件日志（Event Log）** | 每个频道的有序事件缓冲区（大小可配置），用于重连时重放。 |
| **订阅者（Subscriber）** | 连接到频道的前端 WebSocket，接收广播事件并可向上游发送消息。 |
| **上行连接（Upstream Socket）** | 代理到 Noobot 后端的单条 WebSocket 连接（每个活跃频道一条）。 |

### 消息流程

1. 客户端发送 `start_or_join` 动作，携带 `userId` + `sessionId`。
2. 代理解析或创建频道，将客户端添加为订阅者。
3. 若无上行连接，代理向后端建立 WebSocket 并转发启动载荷。
4. 后端事件被捕获、排序、记录并广播给所有订阅者。
5. 重连时，客户端发送 `reconnect` 携带 `lastReceivedSeqMap`，代理补发缺失事件。

## 配置

所有配置通过环境变量设置：

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `AGENT_PROXY_PORT` | `10062` | 代理监听端口 |
| `AGENT_PROXY_HOST` | `0.0.0.0` | 代理监听地址 |
| `AGENT_PROXY_UPSTREAM_WS_URL` | `ws://127.0.0.1:10061/chat/ws` | 后端 WebSocket 地址 |
| `AGENT_PROXY_UPSTREAM_HTTP_BASE` | `http://127.0.0.1:10061` | 后端 HTTP 基础地址 |
| `AGENT_PROXY_CHANNEL_RETENTION_MS` | `600000`（10 分钟） | 终态频道保留时间 |
| `AGENT_PROXY_API_KEY_RETENTION_MS` | `86400000`（24 小时） | API Key 身份保留时间 |
| `AGENT_PROXY_MAX_CHANNEL_EVENTS` | `2000` | 每个频道最大缓冲事件数 |
| `AGENT_PROXY_CLEANUP_INTERVAL_MS` | `15000` | 清理定时器间隔 |
| `AGENT_PROXY_MAX_CONNECTIONS` | `1000` | 最大并发 WebSocket 连接数 |
| `AGENT_PROXY_MAX_BODY_SIZE` | `10485760`（10 MB） | 最大 HTTP 请求体大小 |
| `AGENT_PROXY_REQUEST_ID_TTL_MS` | `660000`（11 分钟） | 交互请求 ID 有效期 |
| `AGENT_PROXY_HTTP_UPSTREAM_TIMEOUT_MS` | `30000` | HTTP 上游超时时间 |
| `AGENT_PROXY_REPLAY_ON_RECONNECT` | `false` | 是否启用重连重放 |
| `AGENT_PROXY_MAX_REPLAY_EVENTS` | `5000` | 单次重放最大事件数 |

## 快速开始

```bash
cd agent-proxy
npm install
npm start
```

或自定义上游地址：

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

## 接口端点

| 路径 | 协议 | 说明 |
|---|---|---|
| `/health` | HTTP | 健康检查（返回频道数、活跃连接数） |
| `/chat/ws`, `/api/chat/ws`, `/agent-proxy/ws`, `/api/agent-proxy/ws` | WebSocket | 客户端 WebSocket 连接 |
| `/internal/connect`, `/api/internal/connect` | HTTP | 连接拦截器 |
| *其他路径* | HTTP | 代理转发至后端 |

## 开源协议

[MIT](../LICENSE)
