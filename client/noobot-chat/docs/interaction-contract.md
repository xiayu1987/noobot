# Interaction Contract（前后端统一约定）

本文定义 `interaction_request` / `pendingInteraction` 的统一数据契约与状态语义，供前端状态机、回放、后端工具统一实现。

---

## 1. 事件载荷（v1）

```json
{
  "requestId": "string",
  "sessionId": "string",
  "dialogProcessId": "string",
  "interactionType": "string",
  "content": "string",
  "fields": [],
  "requireEncryption": false,
  "toolName": "string",
  "connectorName": "string",
  "connectorType": "string",
  "interactionData": {},
  "lifecycle": "pending | resolved | failed",
  "ackMode": "manual | auto",
  "resolvedBy": "user | system | auto",
  "notification": {
    "enabled": false,
    "level": "info | success | warning | error",
    "title": "string",
    "content": "string",
    "data": {}
  }
}
```

---

## 2. 状态语义

- `lifecycle=pending`：待处理交互（通常展示表单）
- `lifecycle=resolved`：交互已完成
- `lifecycle=failed`：交互失败（应给重试/错误提示）

- `ackMode=manual`：需要用户动作确认后再收敛
- `ackMode=auto`：可自动收敛（无需弹出可编辑表单）

- `resolvedBy`：交互由谁完成（`user/system/auto`）

---

## 3. 前端收敛规则（严格）

- 自动收敛仅由 **`lifecycle=resolved && ackMode=auto`** 触发
- 不再基于 `interactionType` 做兼容推断
- `interaction_pending` 应优先携带 `pendingInteractions[]`；为兼容旧客户端，同时可携带 `pendingInteraction`
- 前端优先按 `pendingInteractions[]` 入队展示；缺失 payload 时只做短暂等待/补查兜底，超时仍缺失才降级为错误态

---

## 4. 后端当前约定

- `user_interaction`：`pending + manual`
- 连接器补全信息（connect 时请求补参）：`pending + manual`
- 连接器连接成功通知：`resolved + auto + system`
- 连接器重连请求：`pending + manual`
- agent-proxy 状态快照：`interaction_pending + pendingInteractions[] + pendingRequestIds[]`，并保留单个 `pendingInteraction` 兼容字段

---

## 5. 与状态机文档关系

- 状态机总览：`docs/chat-state-machine.md`
- 本文只定义 interaction 契约，不展开完整会话状态机。
