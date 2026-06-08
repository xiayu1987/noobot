# Chat 状态机（纯状态驱动）说明

本文仅描述前端会话状态机，不包含 replay 细节实现。  
目标：统一实时流与回放链路，让 UI 状态只由 `channel_state` 驱动。

---

## 1. 设计原则

1. **状态层**：只消费 `channel_state`（含 reconnect 的 `conversationStates`）。
2. **内容层**：`delta/thinking/done/messages/error` 只更新内容与元数据，不直接改 UI 状态。
3. **一致性优先**：刷新、多端、重连后，状态必须可恢复且结果一致。
4. **语义解耦**：`sending` 表示会话仍在处理中（in-flight），不等价于“所有输入都只读”。

---

## 2. 状态枚举

来源：agent-proxy `channel_state.state`

- `no_conversation`
- `sending`
- `interaction_pending`
- `stopping`
- `reconnecting`
- `completed`
- `stopped`
- `error`
- `expired`

---

## 2.1 Interaction 事件统一字段（v1）

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
  -> channel_state:completed|stopped|error (收敛终态)
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
  - `completed/stopped/error/no_conversation/expired`（终态）
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
