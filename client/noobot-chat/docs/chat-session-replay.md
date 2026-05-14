# Chat Session / Replay 状态与流程说明

本文记录 `noobot-chat` 中会话、流式消息、agent-proxy 回放的关键状态和约束。这个链路一旦有多个入口同时改写 `activeSession.messages`，刷新页面后很容易出现：AI 消息闪烁、上一条消息被影响、用户交互弹窗重复出现、看起来像整页重新加载。

## 1. 核心原则

### 1.1 会话身份必须统一

前端创建新会话时会先有一个本地临时 id：

```txt
local session id  ->  backend sessionId
```

一旦 WebSocket `DONE` 或 reconnect `DONE` 返回后端 `sessionId`，必须立刻把下面三个值统一：

```txt
session.id
session.backendSessionId
activeSessionId
```

否则下一次 `fetchSessions()` 只拿到后端 `sessionId`，会匹配不到当前本地会话对象，导致当前对象被后端 summary 替换，表现为聊天页面像“重新刷新 session”。

相关位置：

- `src/composables/chat/useChatEngine.js`：正常发送完成时同步 id。
- `src/composables/chat/useChatSession.js`：reconnect DONE 快照时同步 id。
- `src/composables/chat/useChatList.js`：查找 session 时同时按 `id` 和 `backendSessionId` 匹配。

### 1.2 agent-proxy 是回放/running 状态来源

刷新后是否需要恢复“思考中 / pending”应以 agent-proxy 返回的 `hasRunningTask` 或明确 pending interaction 为准。

不要仅仅因为 replay cache 里有历史 `thinking/delta` 事件，就推断当前还在 running。缓存中可能包含已经结束的历史事件，直接拿来恢复 pending 会造成“思考中闪烁或卡住”。

相关位置：

- `isSessionEntryRunning()`
- `hasPendingInteractionReplayEvents()`
- `isDialogProcessRecoverable()`

### 1.3 `activeSession.messages` 只能被受控 patch

前端有多个入口可能写消息：

| 入口 | 场景 | 风险 |
| --- | --- | --- |
| `appendMessage()` | 本地发送 user / pending assistant | 本地临时状态还没落库 |
| WebSocket stream | `thinking/delta/interaction_request/done` | 与 reconnect / detail fetch 竞争 |
| agent-proxy reconnect | 刷新后回放 running task | 可能重复、乱序、混合 dialogProcess |
| `fetchSessions()` | 会话列表刷新 | summary 不包含完整 messages |
| `selectSession()/applySessionDetail()` | 拉取会话详情 | 后端快照可能覆盖本地进行中的消息 |

因此：

- `fetchSessions()` 不应直接替换现有 session 对象。
- 后台刷新应使用 `silent + preserveCurrentMessages`。
- `DONE.data.messages` 如果是整段历史，不能无脑整段替换当前消息列表。

## 2. 页面刷新后的初始化顺序

当前约定顺序：

```txt
App mounted
  -> tryAutoConnect()
    -> connectBackend()
      -> onConnected()
        -> fetchSessions()
        -> chatWebSocketClient.connect()
        -> reconnectActiveSession({ force: true })
```

注意：`useReconnect` 不再 watch `connected` 自动 reconnect。连接成功后的 reconnect 只由 `onConnected` 显式触发，避免两条初始化链路同时跑：

```txt
fetchSessions/selectSession/applySessionDetail
reconnectActiveSession/applyReconnectData
```

如果未来重新加入 `connected` watcher，需要保证不会与 `onConnected` 里的 reconnect 重复执行。

## 3. fetchSessions / selectSession 的约束

### 3.1 session 对象引用要稳定

`fetchSessions()` 获取的是 summary，通常没有完整 `messages/rawMessages/sessionDocs`。因此不能简单：

```js
sessions.value = data.sessions.map(mapSummaryToSession)
```

这样会丢掉当前会话内存中的 pending 消息和已渲染消息。

当前做法：

- 用 `buildSessionIdentityMap()` 按 `id` 和 `backendSessionId` 建索引。
- 用 `reconcileSessionObject()` 复用旧 session 对象。
- 用 `sessions.value.splice(...)` 保持数组引用稳定。
- 已有 messages 时保留旧 messages。

### 3.2 后台刷新不要触发 loading skeleton

reconnect 过程中的会话刷新应使用：

```js
fetchSessions(activeId, {
  silent: true,
  preserveCurrentMessages: true,
})
```

`ChatMessageListPanel` 也只在没有消息时显示 detail skeleton：

```vue
loadingSessionDetail && !activeSession?.messages?.length
```

避免已有消息被 skeleton 遮住，看起来像整页刷新。

## 4. agent-proxy replay 处理流程

### 4.1 reconnect payload 处理

```txt
handleReconnect()
  -> chatWebSocketClient.reconnect()
    -> onReconnectData(payload)
      -> applyReconnectData(payload.sessions)
      -> applyReconnectEvent(payload.event, payload.data)
```

`applyReconnectData()` 做几件事：

1. 找可恢复 session：`hasRunningTask` 或 pending interaction。
2. 必要时切到该 session，但使用 silent/preserve 模式。
3. 遍历每个 dialog process 的 replay messages。
4. 按 `dialogProcessId` 拆分混合 batch。
5. 当前 session 直接 apply；非当前 session 放入 `replayCache`。
6. `cacheExpired` 只延迟静默刷新 session list，不直接同步刷新。

### 4.2 replay batch 必须按 dialogProcessId 拆

同一个 batch 可能混入多个 dialog process 的事件。不能只取第一个 `dialogProcessId` 后把整批事件写到一个 assistant 上。

当前做法：

```txt
splitReconnectMessagesByDialogProcessId()
  -> [{ dialogProcessId, messages }]
```

每个 group 独立调用：

```txt
applyReconnectMessagesToActiveSession(messages, dialogProcessId)
```

### 4.3 replay 目标 assistant 的选择

目标选择优先级：

1. 有 `dialogProcessId`：只找同 `dialogProcessId` 的 assistant。
2. 没找到时：只允许复用“最后一个 user 之后”的 pending assistant。
3. 如果 pending assistant 已经有别的 `dialogProcessId`，禁止写入。
4. 如果允许创建且不是 terminal batch，再创建新的 pending assistant。

这条规则是为了避免新一轮 replay 写到上一轮 assistant 上。

## 5. DONE 快照处理

### 5.1 正常发送 DONE

正常发送时，`useChatEngine` 已经持有本轮 `botMsg` 对象，因此 DONE 只应补齐当前 assistant：

- `dialogProcessId`
- `content`
- `modelAlias/modelName/modelRuns`
- `attachmentMetas`
- `tool_calls`
- `pending/statusLabel`

不要在这里用整段 `data.messages` 替换 `activeSession.messages`。

### 5.2 reconnect DONE

reconnect 的 DONE 可能带：

```txt
eventData.messages = 整个 session 历史
```

如果直接 fold 后整体替换，会重新 patch 上一轮消息，造成“上一条 AI 消息也闪 / 内容被影响”。

当前做法：

- 有 `eventData.dialogProcessId` 且当前已有消息时：只 patch 该 dialog process 的 assistant。
- 没有明确 `dialogProcessId` 时，才 fallback 到整体 apply。
- patch 时复用旧 message 对象，尽量不替换对象引用。
- 对 partial snapshot 做 non-degrading patch：不要用空 content/attachments/modelRuns/realtimeLogs 覆盖已有内容。

相关函数：

- `applyDoneMessagesFromReconnect()`
- `applyFoldedMessagesForDialogProcess()`
- `patchMessageObjectPreservingUiState()`

## 6. 渲染 key 规则

消息组件的 key 不能包含会在流式输出或后端快照 patch 中变化的字段。

禁止使用：

```txt
content
partial content hash
ts
```

原因：这些字段变化会导致 Vue remount `ChatMessageItem`，表现为 AI 消息闪烁，甚至上一条消息闪。

当前 key：

```txt
role + (dialogProcessId || taskId || tool_call_id || index) + index
```

相关位置：

- `src/app/ChatMessageListPanel.vue#getMessageRenderKey()`

## 7. 用户交互弹窗去重

agent 交互请求可能在刷新后被 agent-proxy replay。用户点过确认后，如果 replay 又到达，不能再次弹出。

当前做法：

- 按 `requestId` 记录已处理请求。
- 没有稳定 `requestId` 时，用 signature 去重。
- signature 包含：`sessionId/dialogProcessId/interactionType/toolName/connectorType/connectorName/content`。

相关位置：

- `src/composables/chat/useAgentInteraction.js`

## 8. 常见坑 checklist

以后改这块逻辑时，先检查下面几点：

- [ ] 新会话 DONE 后是否同步了 `session.id/backendSessionId/activeSessionId`？
- [ ] `fetchSessions()` 是否保留了当前 session 对象和 messages？
- [ ] 后台刷新是否使用了 `silent + preserveCurrentMessages`？
- [ ] `DONE.data.messages` 是否可能是整段历史？有没有只 patch 当前 `dialogProcessId`？
- [ ] replay batch 是否可能混合多个 `dialogProcessId`？
- [ ] 目标 assistant 是否只允许写入同 `dialogProcessId` 或最后一个 user 之后的 pending assistant？
- [ ] 消息 render key 是否包含 `content/ts` 这类会变化的字段？
- [ ] `connected`、`focus`、`visibilitychange` 是否可能触发重复 reconnect？
- [ ] interaction request 是否做了 requestId/signature 去重？
- [ ] `loadingSessionDetail` 是否会遮住已有消息？

## 9. 建议调试日志点

如果再次出现闪烁或消息错位，优先临时加这些日志，不要先盲改：

```txt
fetchSessions start/end:
  silent, preserveCurrentMessages, activeSessionId, sessions.length, active messages length

selectSession start/end:
  input sessionId, resolved target.id, target.backendSessionId, force, silent, preserveCurrentMessages

applySessionDetail:
  detail.sessionId, preserveCurrentMessages, whether id changed, messages length before/after

applyReconnectData:
  cacheExpired, sessionId, hasRunningTask, dialogProcessIds in payload

applyReconnectMessagesToActiveSession:
  dialogProcessId, event names, seq range, target message index/id/content preview

applyDoneMessagesFromReconnect:
  eventData.sessionId, eventData.dialogProcessId, data.messages count, patch whole or patch dialogProcess only
```

关键是定位“是哪一个入口在刷新/替换/patch messages”，不要同时改多个入口。

## 10. 代码分层

为避免状态规则散落在多个 composable 里，关键规则已提取到 infra 层：

| 文件 | 职责 | 注意 |
| --- | --- | --- |
| `src/composables/infra/sessionIdentity.js` | session id 归一、按 `id/backendSessionId` 匹配、把本地临时会话提升为后端 sessionId | 任何新增 session 刷新/详情逻辑都应复用这里的身份判断 |
| `src/composables/infra/reconnectReplayModel.js` | agent-proxy replay envelope 解析、terminal 判断、dialogProcess 拆分、消息复用/patch 规则 | 这里尽量保持为无 Vue 依赖的纯逻辑，方便测试和复用 |
| `src/composables/chat/useChatList.js` | 会话列表、详情加载、对象引用稳定 | 不要重新实现 session id 匹配规则 |
| `src/composables/chat/useChatSession.js` | reconnect 编排与状态写入 | 只保留需要访问 `activeSession/sending/ws` 的副作用代码 |
| `src/composables/chat/useChatEngine.js` | 正常发送流式过程 | DONE 后统一调用 session identity 提升逻辑 |

后续如果要继续拆，可以优先把 `useChatSession.js` 中的 reconnect 编排再单独提为 `useReconnectReplay()`，但要保持一个原则：**真正写 `activeSession.messages` 的入口必须少且明确**，不要为了拆文件反而增加隐式写入入口。
