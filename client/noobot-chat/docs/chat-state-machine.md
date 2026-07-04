# Chat 状态机（纯状态驱动）说明

本文描述前端会话状态机与后端 `channel_state` 的分层关系，不包含 replay 细节实现。  
目标：统一实时流与回放链路，同时区分“后端完成”和“前端完成”：`completed` 只表示后端完成，前端完成终态为 `frontend_completed`。

---

## 1. 设计原则

1. **状态层**：只消费 `channel_state`（含 reconnect 的 `conversationStates`）。
2. **内容层**：`delta/thinking/done/messages/error` 只更新内容与元数据，不直接改 UI 状态。
3. **一致性优先**：刷新、多端、重连后，状态必须可恢复且结果一致。
4. **语义解耦**：`sending` 表示会话仍在处理中（in-flight），不等价于“所有输入都只读”。
5. **单一事实源**：`runStateSnapshot`、`sending`、`canStop` 只能由状态机评估结果统一派生；业务链路不得在触发状态机事件后再手动覆盖这些字段。
6. **展示快照边界**：`message.channelState` 是单条消息的展示/历史恢复快照，可携带 `pending`、`statusLabel`、thinking timing 等展示元数据；它不是全局 run/channel 状态事实源，也不参与 `sending` / `canStop` 的事实判断。

---

## 2. 状态枚举边界

### 2.1 `BackendChannelState`

来源：agent-proxy `channel_state.state`，表示后端 channel/run 对外状态：

- `no_conversation`
- `sending`
- `interaction_pending`
- `stopping`
- `reconnecting`
- `completed`
- `stopped`
- `error`
- `expired`

### 2.2 `BackendTerminalStates`

后端视角的终态：

- `completed`：后端正常完成；前端仍需继续 completion 收敛
- `stopped`
- `error`
- `expired`
- `no_conversation`

### 2.3 `FrontendRunState`

前端本地 run 流程状态：

- `idle`
- `resend_replacing_turn`
- `resend_streaming`
- `stop_requested`
- `frontend_completion_requesting`
- `frontend_completed`
- `cancelled`

其中 `frontend_completed` 表示前端完成终态；`completed` 不属于前端本地完成态。

### 2.4 `FrontendTerminalStates`

前端状态机当前用于锁定/收敛 UI 的终态集合：

- `frontend_completed`
- `cancelled`
- `stopped`
- `error`
- `expired`
- `no_conversation`

注意：`completed` 属于 `BackendTerminalStates`，但不属于 `FrontendTerminalStates`；它会继续过渡到 `frontend_completion_requesting`，最终收敛为 `frontend_completed`。

---

## 2.5 Interaction 事件统一字段（v1）

`pendingInteraction` / `interaction_request` 建议统一携带：

- `interactionType`: 业务类型（如 `connector_connected`）
- `lifecycle`: `pending | resolved | failed`
- `ackMode`: `manual | auto`
- `resolvedBy`: `user | system | auto`
- `notification`: `{ enabled, level, title, content, data }`

执行策略（严格）：
- 自动收敛仅由 `lifecycle=resolved` 且 `ackMode=auto` 触发；
- 不再基于 `interactionType` 做兼容推断自动收敛。

后端当前约定（已接入）：
- 连接成功通知：`lifecycle=resolved` + `ackMode=auto` + `resolvedBy=system`
- 需要重连交互：`lifecycle=pending` + `ackMode=manual`
- `user_interaction` 工具发起表单：`lifecycle=pending` + `ackMode=manual`

---

## 3. 每个状态的前端处理

### `no_conversation`
- `sending=false`
- 清理交互态（`pendingInteractionRequest=null`）
- `interactionSubmitting=false`

### `sending`
- `sending=true`
- assistant `pending=true`
- **仅当 `sourceEvent=interaction_response` 时**，清理同轮过期交互态（如果有）
  - 目的：避免在回放或状态重放中，`interaction_pending` 刚恢复出的表单被后续泛化 `sending` 误清理
  - 说明：`sending` 可由 `thinking/delta` 映射而来，不等价于“用户已提交交互响应”

### `interaction_pending`
- `sending=true`
- assistant `pending=true`
- 优先从 `pendingInteractions[]` 恢复交互队列；没有数组时兼容读取单个 `pendingInteraction`
- `interactionSubmitting=false`（用户还没点确认，按钮应可点击）
- 若交互 payload 缺失：先短暂等待/补查后续 `interaction_request`，超时仍缺失才降级为 `error`

### `stopping`
- `sending=true`
- assistant `pending=true`
- assistant `statusLabel=chat.stopping`

### `reconnecting`
- `sending=true`
- assistant `pending=true`
- assistant `statusLabel=chat.reconnecting`

### `completed`
- 含义：后端已完成，本状态不是前端终态
- 前端状态机仍视为 in-flight：`sending=true`
- assistant 暂不标记生成完成，等待前端 completion 收敛
- 后续应进入 `frontend_completion_requesting`，最终收敛到 `frontend_completed`

### `frontend_completion_requesting`
- 含义：前端正在请求/应用 completion 收敛
- `sending=true`
- assistant 暂不标记生成完成

### `frontend_completed`
- 含义：前端完成终态
- `sending=false`
- assistant `pending=false`
- assistant `statusLabel=chat.generated`
- 清理同轮交互态

### `stopped`
- `sending=false`
- assistant `pending=false`
- assistant `statusLabel=chat.stopped`
- 清理同轮交互态

### `error`
- `sending=false`
- assistant `pending=false`
- assistant `statusLabel=chat.failed`
- 清理同轮交互态
- （错误文本可由事件层写入 `assistant.error`）

### `expired`
- `sending=false`
- 清理交互态
- 触发静默刷新会话（防缓存过期导致 UI 失真）
- 刷新结果必须收敛：
  - 刷新成功：进入 `no_conversation` 或服务端返回的真实状态
  - 刷新失败：进入 `error` 并提示“会话已过期，请新建对话”

---

## 4. 时序

## 4.1 实时流（非回放）

```txt
send
  -> ws events: thinking/delta/... (只更新内容)
  -> channel_state:sending/interaction_pending/... (更新状态)
  -> interaction_pending --(用户确认/取消)--> sending
  -> channel_state:completed (后端完成，非前端终态)
  -> frontend_completion_requesting -> frontend_completed (前端收敛终态)
  -> channel_state:stopped|error (停止/错误终态)
```

## 4.2 重连回放（reconnect）

```txt
reconnect
  -> reconnect_data.sessions[].conversationStates (先恢复状态)
  -> replay events (只补内容)
  -> 后续 channel_state 持续驱动终态/交互态
```

> 注：在 `interaction_pending` 之后，收到 `channel_state:sending` 是允许且正常的。  
> 前端必须结合 `sourceEvent` 判定是否可清理交互态，而不是只看 `state=sending`。

---

## 5. 交互态一致性

当状态为 `interaction_pending` 时，agent-proxy 会在状态中附带：

```json
{
  "pendingInteraction": {
    "requestId": "...",
    "sessionId": "...",
    "dialogProcessId": "...",
    "interactionType": "...",
    "content": "..."
  }
}
```

前端据此恢复交互表单，保证刷新/多端一致。

交互态清理闭环（必须同时满足）：
- 恢复入口：`interaction_pending + pendingInteraction`
- 清理入口：
  - `frontend_completed/stopped/error/no_conversation/expired`（前端终态）
  - `completed` 仅表示后端完成，需等前端收敛到 `frontend_completed` 后再按完成终态清理
  - `sending + sourceEvent=interaction_response`（用户已响应，回到执行态）
- 非清理入口：
  - `sending`（无 `sourceEvent` 或非 `interaction_response`）
  - replay 内容事件（`thinking/delta`）

特殊分支（连接器已连接）：
- 当 `interactionType=connector_connected` 时，前端会走自动处理分支：
  - 更新连接器面板状态
  - 自动提交 `interaction_response`（`connector_connected_ack`）
  - 清理当前交互态
- 该分支用于“连接成功通知”类事件，不需要用户手动填写表单。
- 若业务需要用户停留确认，请不要使用 `connector_connected` 作为交互类型。

输入可用性约束：
- 主输入框：可用条件不应仅由 `sending` 决定，应结合是否处于交互态
- 交互表单：由 `interactionSubmitting` 控制提交按钮，避免被全局 `sending` 误禁用

---

## 6. 调试

开发环境默认可开启状态机调试面板（底部）：
- 当前 `sending / interactionSubmitting / pending request`
- `State Snapshot`
- `State Timeline`（最近状态事件）

可通过 `VITE_NOOBOT_DEBUG_CONVERSATION_STATE_PANEL` 显式开关。

---

## 7. 相关代码

- 前端实时状态处理：`src/composables/chat/useChatEngine.js`
- 前端回放状态处理：`src/composables/chat/useReconnectReplay.js`
- Interaction 契约：`docs/interaction-contract.md`
- 状态来源与广播：`agent-proxy/src/channel-manager.js`
- 状态测试：
  - `tests/unit/composables/chat/useChatEngine.spec.js`
  - `tests/unit/composables/chat/useReconnectReplay.spec.js`
  - `agent-proxy/__tests__/channel-manager.state-consistency.test.js`
