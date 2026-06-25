# Agent Message Context Convergence

本文档记录 agent 主链路消息上下文收敛路线。目标是把模型窗口、分块视图、插件上下文解析中的消息对象收敛到一个通用事实源，避免同一逻辑消息在不同数组副本中状态不一致。

## 背景

agent 主链路目前同时维护多种消息视图：

- `loopState.messages`：当前主模型窗口。
- `loopState.messageBlocks.system/history/incremental`：主链路构造出的分块视图。
- `ctx.messageBlocks`：传给 hook/plugin 的分块上下文。
- `turnMessages` / `currentTurnMessages`：当前轮落盘和展示消息。
- `agentContext.payload.messages.system/history`：上下文构建阶段的输入视图。

这些视图的生命周期不同，不能简单合并成一个数组；但同一逻辑消息在多个视图中出现时，应共享稳定 message id 和 canonical 对象。

## 收敛原则

1. agent 通用层只处理 message id、canonical object、blocks id view，不包含 harness summary/checkpoint 等插件业务策略。
2. `loopState.messages` 和 `turnMessages` 仍保持不同语义：前者是模型窗口，后者是当前轮产物。
3. `messageBlocks` 是视图，不应拥有独立消息状态；保留数组 API 的同时维护 `systemIds/historyIds/incrementalIds`。
4. 写入口逐步收敛到统一 API，先管住构造入口，再收敛 turn loop 中的追加/替换。
5. 不改变 `agentContext.payload.messages.system` 可能为字符串 channel 的兼容语义。

## 实施阶段

### 阶段 1：agent 通用 message store 与 state-builder 接入

状态：已完成。

新增 agent 通用 message context 模块，提供最小 API：

```js
canonicalizeMessageStore(ctx)
replaceMessages(ctx, messages)
appendMessage(ctx, message, { block })
writeMessageBlocks(ctx, blocks)
getMessageId(message)
```

第一步只在 `state-builder` 生成 `loopState` 后 canonicalize `messages/messageBlocks`，确保初始主模型窗口和 block 视图共享 message id 与对象引用。

验收标准：

- `loopState.messages` 与 `loopState.messageBlocks.*` 中同一逻辑消息共享同一个对象。
- `loopState.messageBlocks` 同步维护 `systemIds/historyIds/incrementalIds`。
- 不改变 `buildContextMessages` / `buildContextMessageBlocks` 的业务输出顺序。

当前进展：

- 已新增 `agent/core/message-context/message-store.js` 通用模块。
- 已在 `state-builder` 生成 `loopState` 后执行 `canonicalizeMessageStore(loopState)`。
- 已新增 `message-store.test.js` 与 `state-builder-message-context.test.js` 覆盖 canonical 对象、message id 与 block id 视图。

### 阶段 2：plugin/model message resolver 读取 id 视图

状态：已完成。

让 `_createPluginResolveModelMessages` / `ModelMessageRuntimeHelpers` 优先接受 canonicalized blocks，读取时不再依赖对象副本状态。

验收标准：

- resolver 不修改源 `messages/messageBlocks`。
- summarized/filter 读取同一个 canonical 状态。
- 仍兼容没有 ids 的历史输入。

当前进展：

- `ModelMessageRuntimeHelpers.createResolveModelMessages` 在 blocks 带 `systemIds/historyIds/incrementalIds` 且可解析时，优先从 canonical store materialize 消息。
- 没有 ids 或 ids 不完整时保持原数组兼容路径。
- 已新增 `model-message-runtime-message-store.test.js` 覆盖 stale block copy 通过 ids 读取 canonical summarized 状态，且不修改 stale copy。

### 阶段 3：turn loop 写入口收敛

状态：主路径完成，清理/兼容入口保留。

逐步迁移 `loopState.messages.push/splice` 等写入口到统一 API。重点文件包括：

- `agent/core/loop-control.js`
- `agent/core/turn/orchestrator.js`
- `agent/core/turn/turn-executor.js`
- `agent/core/turn/response-processor.js`
- no-tools/retry stages

验收标准：

- 主模型窗口新增/替换消息通过统一 API。
- 需要进入 incremental block 的当前轮消息同步写入 block id 视图。
- `turnMessages/currentTurnMessages` 的落盘语义不被改变。

当前进展：

- `loop-control` 中 phase summary prompt、help tool loop prompt、help tool failure prompt 已迁移到 `appendMessage(loopState, ..., { block: "incremental" })`。
- `turn/orchestrator` 中 tool loop limit finalize prompt 与 tool choice required retry prompt 已迁移到 `appendMessage`。
- reasoning-only retry stage 的 no-tools / with-tools retry prompt 已迁移到 `appendMessage`。
- no-tools final streaming stage 的最终模型响应已迁移到 `appendMessage`。
- with-tools turn executor 的 assistant 普通响应 / assistant tool-call 消息已迁移到 `appendMessage`。
- state committer 的 tool result 模型窗口追加已迁移到 `appendMessage`；`turnMessageStore` 落盘 payload 保持原语义。
- synthetic response processor 的拆分 tool-call assistant 消息已迁移到 `appendMessage`。
- 剩余写入口主要是清理类 `splice/pop`、fallback 兼容路径，以及 model-only helper。

### 阶段 4：守卫与插件复用

状态：进行中。

在 agent 侧增加 boundary test，防止主链路重新裸写 `loopState.messages`。harness 插件在 agent 通用模块稳定后，可再把插件侧 store 适配为复用 agent 通用 API。

验收标准：

- agent 主链路有扫描守卫。
- harness 保留 checkpoint/summary 策略，只复用底层 message context API。

当前进展：

- 已新增 `message-context-boundary.test.js`，扫描 `agent/core` 下模型窗口写入口。
- 守卫允许 `message-store`、清理类入口、fallback 兼容 stage 和 `model-only-message` helper；其他主链路新增裸写会失败。
- harness 插件已将自身 `core/message-store.js` 收敛为 agent 通用 message context API 的 wrapper；summary/checkpoint 策略仍保留在 harness 侧。

## 当前执行顺序

1. 阶段 1 已完成：新增通用模块和 state-builder 接入测试。
2. 阶段 2 已完成：resolver 读取 canonical 状态，同时保留无 ids 输入兼容。
3. 阶段 3 主路径已完成：内部提示、reasoning retry、最终 assistant 响应、tool result、synthetic tool turn 写入口已收敛；清理类和 fallback 兼容入口保留。
4. 阶段 4 已完成：已新增 agent boundary 守卫，harness 已切换到 agent 通用 API wrapper。
