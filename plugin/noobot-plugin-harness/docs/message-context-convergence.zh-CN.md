# Message Context Convergence

本文档记录 harness 消息上下文收敛路线。目标是消除 `ctx.messages`、`messageBlocks`、summary checkpoint 等多个视图之间的可变副本不一致问题。

## 背景

当前主流程会同时维护：

- `ctx.messages`：即将发给模型的当前窗口。
- `ctx.messageBlocks.system/history/incremental`：可重算的分块视图。
- summary checkpoint：小结生成前的消息边界。

历史问题来自“同一条逻辑消息在多个数组里以不同对象副本存在”，导致某个视图被标记为 `summarized` 后，另一个视图仍未标记，并在后续增量上下文中重新进入模型。

## 收敛原则

1. 消息状态只能有一个事实源。
2. 分块结构只表达视图，不拥有独立消息状态。
3. checkpoint 应表达“哪些消息”，而不是“某个数组的前 N 条”。
4. 写入口最终应集中到统一 API，避免业务代码裸写多个数组后忘记同步。

## 实施阶段

### 阶段 1：messageId + checkpoint ids

状态：已完成。

给进入 harness 消息上下文的每条消息分配稳定 `messageId`，并写入消息对象元数据。summary checkpoint 记录 checkpoint 范围内的 `messageId` 集合，而不是只记录 `ctx.messages.length`。

验收标准：

- 同一逻辑消息在 `ctx.messages` 与 `messageBlocks` 中共享同一个 `messageId`。
- summary checkpoint 只使用 `summaryCheckpointMessageIds` 标记消息。
- summary relay 仍不被当前 checkpoint 标记。

### 阶段 2：canonical blocks 投影

状态：已完成。

消息实体由 canonical store 统一管理，`messageBlocks` 只保留对象数组投影：

```js
messageStore: { byId, order }
messageBlocks: {
  system: [canonicalMessage],
  history: [canonicalMessage],
  incremental: [canonicalMessage]
}
```

对象数组由 store materialize，同一 `messageId` 对应同一个 canonical 对象。废弃的 `systemIds/historyIds/incrementalIds` 不再维护，也不存在 ids fallback。

验收标准：

- 内部写回 blocks 统一通过协议 store API。
- 插件读取 `messageBlocks.system/history/incremental` 时获得 canonical 投影。
- summarized/filter/compaction 都以 id 为主，不再靠对象引用或内容签名。

### 阶段 3：收口所有写入口

状态：主路径完成，兼容通道保留。

提供统一消息上下文 API：

```js
appendMessage(ctx, message, { block: "incremental" })
replaceMessages(ctx, messages)
writeMessageBlocks(ctx, blocks)
```

业务代码不再直接维护多个数组的一致性。

验收标准：

- 新增/替换/标记消息只能通过统一 API。
- 裸写 `ctx.messages.push`、`ctx.messageBlocks.incremental = ...` 等路径被迁移或限制在兼容层。
- summary、planning、prompt injection、final compaction 共享同一套写入语义。

当前进展：

- 已提供 `appendMessage`、`replaceMessages`、`writeMessageBlocks`；小结打标只能请求 canonical summary checkpoint。
- `core/hooks` 与 `capabilities/runtime` 的 blocks 写回已迁移到 `writeMessageBlocks`。
- 公共消息注入入口 `injectMessageWithPolicy` 已迁移到统一 API。
- planning current task goal 注入已迁移到 `appendMessage`。
- acceptance overflow/phase prompt 注入已迁移到 `appendMessage`。
- prompt injector 批量插入后通过 `replaceMessages` 统一 canonicalize。
- legacy message takeover 注入已迁移到 `appendMessage`。
- 复杂 takeover 路径已按目标拆分：`ctx_messages` 通过 `appendMessage`/`replaceMessages` 写入 store，`agent_system` 保持原数组通道，避免改变业务语义。
- final compaction 与 runtime blocks 应用已迁移到 `replaceMessages`。
- prompt injector 已改为本地 `nextMessages` 组装后统一 `replaceMessages` 写回；system prompt 通过 `writeMessageBlocks` 更新 canonical blocks。
- 已新增 `message-context-boundary.test.js` 守卫，防止业务路径重新出现 `ctx.messages`/`messageBlocks` 裸写。
- `core/message-store.js` 已收敛为 `@noobot/context-protocol` wrapper，不暴露任意小结打标入口。
- 当前 `ctx.messages` 裸写扫描结果只剩 `message-store` 统一入口和 `core/context` 初始化入口；takeover 的剩余数组操作只在 `agent_system` 兼容通道。

## 当前执行顺序

1. 阶段 1 已完成：checkpoint 从 count 过渡到 ids。
2. 阶段 2 已完成：blocks 只保留 canonical 对象投影，废弃并行 ids 视图。
3. 阶段 3 主路径已完成：业务主链路写入口已收敛到统一 API；`agent_system` 等兼容通道保留原语义。
4. 公共协议复用已完成：Harness 不再维护独立 message store，也不依赖 Agent 私有源码。
