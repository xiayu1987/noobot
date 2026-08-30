# Agent Proxy

中文 | [English](./README.md)

Noobot Agent Proxy 是客户端与 Noobot Service 之间的 HTTP/WebSocket 网关，负责连接扇出、频道访问控制、重连权威状态同步、传输投递、限流和可选的前端托管，不持有 Agent 业务状态。

## 架构

```text
客户端  -- HTTP/WebSocket -->  Agent Proxy :10062  -- HTTP/WebSocket -->  Service :10061
```

频道由 `userId + sessionId + parentSessionId + parentDialogProcessId` 唯一标识。一个频道可以有多个下游订阅者和一条活跃上游连接。

## 传输行为

- Agent 命令使用 `@noobot/agent-transport-protocol`；发送、重发、继续、停止、结束、交互响应和快照/查询命令按命令类型路由。
- 后端协议事件经过校验和排序后广播，不改变业务身份。
- Turn 生命周期事件使用回执和有限次数重投。
- 重连请求携带 `currentSessionId`、`requestId` 和 `knownLifecycleSequenceMap`。
- 重连按 Session 返回一个权威 `replayBatch`，其中可包含 Turn 快照、快照后的连续生命周期事件以及完整的未完成 `pendingInteractions` 事件。
- 消息游标和载荷片段不是重连事实源；重连只接受上述生命周期序列映射。

重连 wire shape 由 `@noobot/event-protocol`、`@noobot/session-protocol` 和 `@noobot/agent-transport-protocol` 共同定义；本包只负责传输编排。

## 配置

配置首先读取 `agent-proxy.config.json`，环境变量优先。完整配置键、默认值、规范化规则和环境变量映射只以 `src/shared/config.js` 为事实源。

核心配置：

| 环境变量                                           | 默认值                         | 用途                                 |
| -------------------------------------------------- | ------------------------------ | ------------------------------------ |
| `AGENT_PROXY_PORT`                                 | `10062`                        | 监听端口                             |
| `AGENT_PROXY_HOST`                                 | `0.0.0.0`                      | 监听地址                             |
| `AGENT_PROXY_UPSTREAM_WS_URL`                      | `ws://127.0.0.1:10061/chat/ws` | Service WebSocket 地址               |
| `AGENT_PROXY_UPSTREAM_HTTP_BASE`                   | `http://127.0.0.1:10061`       | Service HTTP 基础地址                |
| `AGENT_PROXY_HTTP_UPSTREAM_TIMEOUT_MS`             | `60000`                        | 上游 HTTP 超时                       |
| `AGENT_PROXY_RECONNECT_SNAPSHOT_TIMEOUT_MS`        | 共享时间阈值                   | 重连快照超时                         |
| `AGENT_PROXY_TURN_LIFECYCLE_RECEIPT_TIMEOUT_MS`    | 共享时间阈值                   | 生命周期回执超时                     |
| `AGENT_PROXY_TURN_LIFECYCLE_DELIVERY_MAX_ATTEMPTS` | 共享轮次阈值                   | 生命周期事件最大投递次数             |
| `AGENT_PROXY_WS_MAX_PAYLOAD_BYTES`                 | 共享长度阈值                   | WebSocket 最大输入载荷               |
| `AGENT_PROXY_WS_MAX_BUFFERED_BYTES`                | 共享长度阈值                   | WebSocket 最大缓冲输出               |
| `AGENT_PROXY_TRUSTED_ORIGINS`                      | 空                             | 逗号分隔的可信 Origin；空表示不限制  |
| `AGENT_PROXY_TRUSTED_IPS`                          | 空                             | 逗号分隔的可信 IP 模式；空表示不限制 |
| `AGENT_PROXY_CONNECT_TOKEN`                        | 空                             | 配置后用于保护连接拦截接口           |
| `AGENT_PROXY_HTTP_RATE_LIMIT_ENABLED`              | `true`                         | 开启 HTTP 限流                       |
| `AGENT_PROXY_WS_RATE_LIMIT_ENABLED`                | `true`                         | 开启 WebSocket 升级限流              |
| `AGENT_PROXY_FRONTEND_ROOT`                        | 空                             | 可选的前端构建目录                   |

部署文档不要复制完整配置 schema。新增或修改配置时，以 `src/shared/config.js` 为准。

## 运行与测试

```bash
cd agent-proxy
npm install
npm start
npm test
```

PM2 命令：

```bash
npm run pm2:start
npm run pm2:restart
npm run pm2:stop
npm run pm2:delete
npm run pm2:logs
npm run pm2:list
```

## 接口

| 路径                                                                 | 协议                | 用途                                 |
| -------------------------------------------------------------------- | ------------------- | ------------------------------------ |
| `/health`                                                            | HTTP                | 健康状态和活跃连接摘要               |
| `/chat/ws`、`/api/chat/ws`、`/agent-proxy/ws`、`/api/agent-proxy/ws` | WebSocket           | Agent 传输                           |
| `/logs/ws`、`/api/logs/ws`                                           | WebSocket 代理      | 运行日志流                           |
| `/internal/connect`、`/api/internal/connect`                         | HTTP                | 受认证保护的连接拦截接口             |
| `/ide`、`/ide/*`                                                     | HTTP/WebSocket 代理 | IDE 路由                             |
| 其他 HTTP 路径                                                       | HTTP 代理           | 转发到 Service；默认移除 `/api` 前缀 |

当 `AGENT_PROXY_FRONTEND_ROOT` 指向前端构建目录时，非 API 的 GET/HEAD 路由按 SPA 提供。

## 开源协议

[MIT](../LICENSE)
