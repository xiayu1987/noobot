# Noobot 超时/TTL/等待时长盘点

> 更新时间：2026-06-06  
> 范围：`service/`、`agent/src/`、`agent-proxy/src/`、`client/noobot-chat/src/`、`plugin/*/src/`、`service/config/`、`user-template/default-user/config*`、`workspace/*/config*`、`start.sh`。  
> 说明：包含**配置项**与**代码写死默认值**（不含 `node_modules`、测试目录、第三方 vendor 文本）。

## 结论

- 不同超时/TTL/等待时长（按值去重）：**34 个**。
- 覆盖毫秒与秒（`start.sh`）两类表示。

---

## 1) 配置项（配置文件/模板）

| 时长 | 定位 | 用途说明 |
|---|---|---|
| `120000` ms | `service/config/global.config.json:105,154`；`service/config/global.config.example.json:105,154`；`user-template/default-user/config.json:96,151`；`user-template/default-user/config.example.json:96,151`；`workspace/xiayu/config.json:96,151`；`workspace/admin/config.json:96,151` | 异步委派等待超时、脚本执行超时默认值。 |
| `7200000` ms | `service/config/global.config.json:472`；`service/config/global.config.example.json:472`；`user-template/default-user/config.json:446`；`user-template/default-user/config.example.json:446`；`workspace/xiayu/config.json:427`；`workspace/admin/config.json:652` | 单次会话运行（run）超时默认值。 |
| `18000000` ms | `service/config/global.config.json:294`；`service/config/global.config.example.json:294`；`user-template/default-user/config.json:278`；`user-template/default-user/config.example.json:278`；`workspace/xiayu/config.json:443`；`workspace/admin/config.json:668` | Workflow/插件链路中的任务超时默认值。 |
| `5000` ms | `plugin/noobot-plugin-workflow/manifest.json:16` | workflow 插件 `after_session_delete` 钩子运行超时。 |
| `25` s | `start.sh:434`（`START_WAIT_TIMEOUT_SECONDS` 默认值） | 启动脚本等待服务与端口就绪的最大时长。 |

---

## 2) 代码写死/默认值（非配置文件）

| 时长 | 典型定位 | 用途说明 |
|---|---|---|
| `100` ms | `client/noobot-chat/src/services/ws/chatWebSocketClient.js:196` | WS 建连后首次等待 open 的短轮询间隔。 |
| `150` ms | `client/noobot-chat/src/composables/infra/usePanelState.js:10`；`agent/src/system-core/utils/web/web2img/web2img-config.js:63` | 前端 resize 节流；web2img 点击后等待。 |
| `300` ms | `client/noobot-chat/src/services/ws/chatWebSocketClient.js:10`；`agent/src/system-core/utils/web/browser-simulate.js:161`；`agent/src/system-core/utils/web/web2img/web2img-config.js:69` | stop 关闭延迟；浏览器抓取稳定等待；滚动回顶等待。 |
| `350` ms | `service/services/openvscode-service.js:438` | OpenVSCode 启动探活时单次端口检测超时。 |
| `500` ms | `service/services/openvscode-service.js:142`；`agent/src/system-core/utils/web/web2img/web2img-config.js:61` | OpenVSCode 端口探测 socket 超时；元素可见检测超时。 |
| `800` ms | `agent/src/system-core/utils/web/web2img/web2img-config.js:56,62` | web2img 页面 ready 后追加等待；点击动作超时。 |
| `1000` ms | `agent/src/system-core/bot-manage/config/constants.js:90`；`agent/src/system-core/connectors/databases/common-db-connector-channel.js:58`；`agent/src/system-core/connectors/terminals/ssh-connector-channel.js:16`；`plugin/noobot-plugin-harness/src/core/options.js:30` | 各模块最小超时下限（异步等待、DB/SSH、harness hook）。 |
| `1200` ms | `client/noobot-chat/src/composables/chat/useChatEngine.js:267`；`client/noobot-chat/src/composables/chat/useReconnectReplay.js:464` | 会话过期后延迟刷新 session 列表。 |
| `2000` ms | `plugin/noobot-plugin-harness/src/core/options.js:53`；`plugin/noobot-plugin-harness/src/core/hooks.js:360` | harness flush hook/清理 hook 的超时保底。 |
| `3000` ms | `agent/src/system-core/hook/index.js:10` | 通用 hook 默认超时。 |
| `4500` ms | `agent/src/system-core/utils/web/browser-simulate.js:100` | 浏览器模拟抓取时 `networkidle` 等待超时。 |
| `5000` ms | `client/noobot-chat/src/services/ws/chatWebSocketClient.js:11`；`agent/src/system-core/bot-manage/execution/memory-postprocess.js:15`；`agent/src/system-core/bot-manage/execution/finalizer.js:22` | 前端强制 stop finalize 超时；执行收尾 bundle 超时。 |
| `6000` ms | `service/routes/connectors-routes.js:107`；`agent/src/system-core/connectors/channel-store.js:372,501` | 连接器状态检查/探活超时。 |
| `8000` ms | `agent/src/system-core/tools/connectors/connector-toolkit.js:105`；`agent/src/system-core/tools/connectors/connector-toolkit/connector-runtime.js:178` | 连接器工具查询运行态超时。 |
| `10000` ms | `service/ws/chat-websocket-server.js:14`；`agent/src/system-core/tools/data-processing/web2data-tool.js:318` | run timeout 最小值；web2data network idle 超时。 |
| `12000` ms | `agent/src/system-core/utils/web/web2img/web2img-config.js:55` | web2img 页面 network idle 超时。 |
| `15000` ms | `client/noobot-chat/src/services/ws/chatWebSocketClient.js:26`；`agent-proxy/src/config.js:99` | 前端重连超时；agent-proxy 清理周期默认值。 |
| `20000` ms | `agent/src/system-core/utils/web/browser-simulate.js:151`；`agent/src/system-core/utils/web/web2img/web2img-config.js:54` | 文档 readyState 等待上限。 |
| `30000` ms | `service/services/openvscode-service.js:18`；`agent/src/system-core/connectors/channel-store.js:286`；`agent/src/system-core/connectors/databases/*`；`agent/src/system-core/connectors/terminals/ssh-connector-channel.js:18`；`agent-proxy/src/config.js:118` | 连接器执行与上游 HTTP 请求常用默认超时。 |
| `45000` ms | `agent/src/system-core/tools/data-processing/web2data-tool.js:317`；`agent/src/system-core/utils/web/web2img/web2img-config.js:53,57` | 网页抓取/截图入口超时（页面加载与 goto）。 |
| `60000` ms | `agent/src/system-core/connectors/databases/postgres-connector-channel.js:66` | Postgres 连接池空闲连接回收超时。 |
| `120000` ms | `agent/src/system-core/bot-manage/config/constants.js:89`；`agent/src/system-core/tools/execution/script-tool.js:33`；`agent/src/system-core/tools/workflow/agent-collab-tool.js:77` | 异步任务默认等待、脚本执行默认超时、协作工具默认 wait。 |
| `180000` ms | `agent/src/system-core/bot-manage/session/session-execution-engine.js:1520,1521` | workflow 规划插件最小超时保护（低于 3 分钟会抬升）。 |
| `300000` ms | `agent/src/system-core/bot-manage/execution/memory-postprocess.js:14` | memory summary 后处理超时。 |
| `600000` ms | `service/ws/chat-websocket-server.js:202`；`agent-proxy/src/config.js:86` | 用户交互请求超时（10 分钟）；proxy channel retention。 |
| `660000` ms | `agent-proxy/src/config.js:112` | agent-proxy 交互 requestId TTL（11 分钟）。 |
| `900000` ms | `agent/src/system-core/session/repositories/file-system-session-repository.js:20,31` | 已删除会话缓存保护 TTL（15 分钟）。 |
| `3600000` ms | `agent/src/system-core/tools/execution/script-tool.js:35` | Docker 容器队列锁等待超时（1 小时）。 |
| `7200000` ms | `service/ws/chat-websocket-server.js:13` | run timeout 默认值（2 小时）。 |
| `10800000` ms | `service/services/openvscode-service.js:19` | OpenVSCode 实例空闲超时（3 小时）。 |
| `18000000` ms | `plugin/noobot-plugin-workflow/src/core/constants.js:30,34` | workflow 插件总超时与 node-agent 超时默认值（5 小时）。 |
| `43200000` ms | `service/ws/chat-websocket-server.js:15` | run timeout 最大上限（12 小时）。 |
| `86400000` ms | `service/services/auth-service.js:10`；`service/bootstrap/create-app-dependencies.js:94`；`service/services/runtime-config-service.js:27`；`agent-proxy/src/config.js:92` | API Key / proxy 缓存保留默认 TTL（24 小时）。 |

---

## 3) 备注

1. 本文是“时长值盘点”视角，优先记录可导致行为超时、过期、轮询等待、清理周期的常量与默认值。
2. 某些代码行（如状态码、比较表达式）虽包含数字，但不属于“时长语义”，未纳入最终 34 个时长值集合。
3. 如需进一步治理，建议下一步输出 CSV（`value_ms, module, file, line, key, purpose`）并按“统一配置化优先级”排序。


---

## 4) 关联规范

- 统一规范：[`docs/timeout-unification-spec.md`](./timeout-unification-spec.md)
- 建议先按本盘点定位现状，再按统一规范做字段收敛与迁移。
