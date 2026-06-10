# 插件参与模式：模型消息流（Agent + 插件侧）

本文档描述 **插件参与时** 的最终传模消息如何生成，以及与 Agent 原生模式的关键差异。

## 1) 一眼看懂

```text
Agent 先产出 messageBlocks:
  system（不参与历史裁剪）
  history（统一过滤+裁剪）
  incremental（当前用户 + 插件注入增量 + 自身增量，统一过滤+裁剪）

插件在 before_llm_call 基于 messageBlocks 重组 ctx.messages
随后 hooks 层会做一次最终 conversation 压缩（system + conversation）
最终调用前仍会执行 filterForModelContext(messages)
```

第一轮重组顺序口径：

```text
system -> history -> incremental
```

> 注意：这不是最终 `ctx.messages` 的完整形态。当前实现中 hooks 层还会执行一次最终 conversation 压缩，最终写回 `ctx.messages` 的形态是 `system -> conversation`，其中 `conversation = recentN(history + incremental)`。因此默认配置下，`history` 与 `incremental` 合计会再受一次 `contextWindowRecentMessageLimit`（默认 20）约束，不等价于 `history 20 + incremental 20`。

---

## 2) 职责边界

### Agent 侧
1. 构建并透传 `messageBlocks`（`system/history/incremental`）。
2. 提供统一入口：`resolveMessageBlock({ scope, messages, ctx })`。
3. 保证“无插件时”仍走原链路，不被影响。

### 插件侧
1. 在 `before_llm_call` 读取 `ctx.messageBlocks`。
2. 先按 `system/history/incremental` 分块调用 `resolveMessageBlock(scope)` 并重组 `ctx.messages`。
3. capability 运行期间允许前置/后置注入；后续 hooks 会把新增 system 合并回 system，把新增非 system 合并回 incremental。
4. 最终通过 `scope=conversation` 对 `history + incremental` 再做一次非 system 合并窗口过滤/裁剪，并写回 `ctx.messages = system + conversation`。

---

## 3) 与 Agent 原生模式对比（保留）

| 维度 | 插件参与模式 | Agent 原生模式 |
|---|---|---|
| 最终顺序控制 | 插件在 `before_llm_call` 重组 `ctx.messages` | Agent `buildContextMessages()` 固定基序 |
| 消息输入形态 | `messageBlocks`（system/history/incremental） | 单一 `messages` 数组 |
| 历史裁剪入口 | `resolveMessageBlock(scope="history")` | `resolveModelContextMessages(...)` |
| 增量裁剪入口 | `resolveMessageBlock(scope="incremental")` | 原生不单独分 incremental 窗口 |
| system 处理 | 不进 recent window | 不进 recent window |
| 最终调用前保护 | `filterForModelContext(messages)` | `filterForModelContext(messages)` |
| 兼容性目标 | 可插拔，不改无插件主链路 | 既有行为保持 |

---

## 4) 统一过滤裁剪入口（当前实现）

函数：`resolveMessageBlock({ scope, messages, ctx })`

- `scope=system`：仅做基础过滤，不做 recent window；
- `scope=history`：recent window，默认 `contextWindowRecentMessageLimit=20`；
- `scope=incremental`：recent window，默认 `incrementalRecentMessageLimit=20`（未配时回落 history limit）。
- `scope=conversation` / `scope=non_system`：对非 system 合并窗口做 recent 过滤，默认与 history 相同（`contextWindowRecentMessageLimit`）。这是最终压缩使用的窗口，输入通常是已经分别处理过的 `history + incremental`。

共同语义：
- 过滤 `summarized: true`；
- 过滤非法 tool-call/tool-result pair；
- 按 `dialogProcessId` 过滤不属于当前链路的 injected 消息；
- 对 injected 消息按 `injectedMessageType`（缺省时回退内部类型 / relay purpose / `type` / `injectedBy`）分组，同一分组只保留最新一条；
- 小结标记时也按同一分组保护最新 injected 消息：同类型最新一条不标 `summarized:true`，同类型更旧的注入消息会被标记并在后续筛选中移除；
- 当前轮 harness injected message 仍参与 `incremental`/`conversation` recent window 裁剪；只有 frontend user message 有额外 anchor 补回逻辑。

### 4.1 当前最终压缩形态

在 `core/hooks.js -> compactFinalConversationWindow(...)` 中，如果存在 `messageBlocks`，当前实现会：

```text
extras = ctx.messages - (system + history + incremental)
extraSystem -> 合并进 system
extraNonSystem -> 合并进 incremental

system2 = resolveMessageBlock(scope=system, system + extraSystem)
history2 = resolveMessageBlock(scope=history, history)
incremental2 = resolveMessageBlock(scope=incremental, incremental + extraNonSystem)
conversation = resolveMessageBlock(scope=conversation, history2 + incremental2)

ctx.messages = system2 + conversation
ctx.messageBlocks = {
  system: system + extraSystem,
  history,
  incremental: incremental + extraNonSystem,
}
```

注意：最终 `ctx.messages` 是传模窗口，可以被 recent window 破坏性裁剪；`ctx.messageBlocks` 则保持为后续 hook 可重算的源块，并通过原对象原地更新，以便小结完成后能基于源块重新过滤 summarized 消息，而不是基于上一次已经裁剪过的传模窗口重算。

因此最终传模前的上下文可近似理解为：

```text
filterForModelContext(
  systemResolved
  + recentN(historyRecentN + incrementalRecentM)
)
```

其中最后的 `recentN(...)` 使用 `contextWindowRecentMessageLimit`，默认 20。

### 4.2 当前最终上下文的精确形态（标注 Agent 侧 / 插件侧）

默认配置下，最终传给模型前的 `ctx.messages` 不是 `system + history + incremental`，而是：

```text
ctx.messages = [
  ...systemResolved,
  ...conversationResolved,
]
```

#### 4.2.1 Agent 侧提供的输入与统一入口

Agent 侧在 hook context 中提供基础分块：

```text
[Agent侧] ctx.messageBlocks = {
  system: originalSystemBlock,
  history: originalHistoryBlock,
  incremental: originalIncrementalBlock,
}
```

Agent 侧同时向 harness options 注入统一过滤/裁剪入口：

```text
[Agent侧] resolveMessageBlock({ scope, messages, ctx })
```

该入口的 scope 语义由 Agent 侧实现：

```text
[Agent侧] system       -> 筛选：基础过滤；裁剪：不做 recent window
[Agent侧] history      -> 筛选：基础过滤；裁剪：recent contextWindowRecentMessageLimit，默认 20
[Agent侧] incremental  -> 筛选：基础过滤；裁剪：recent incrementalRecentMessageLimit，默认 20
[Agent侧] conversation -> 筛选：基础过滤；裁剪：recent contextWindowRecentMessageLimit，默认 20
```

基础筛选规则（`resolveModelContextMessages(...)` + `filterForModelContext(...)`）：

```text
[筛选] dialogProcessId：只过滤 injected message；非当前 dialogProcessId 的 injected message 会被移除
[筛选] injected type：同一 injectedBy + injectedMessageType 分组只保留最新一条；缺省 type 会按内部类型 / relay purpose / type / injectedBy 回退
[筛选] summarized:true：普通 summarized 消息移除；current system_context 是例外
[筛选] tool pair：assistant tool_calls 与 tool result 必须成对，非法/孤立 pair 会被移除
[筛选] task_summary fallback：孤立 task_summary tool result 会转换为 user 角色的 [阶段小结] 消息保留
```

### 注入消息类型字段

Harness 注入到主链路的消息应携带：

```json
{
  "injectedMessage": true,
  "injectedBy": "harness-plugin",
  "injectedMessageType": "<stable-type>"
}
```

`injectedMessageType` 表示注入来源/用途的稳定类型，例如 planning prompt、guidance summary prompt、acceptance validation request、separate model relay 等。筛选和小结标记均使用 `injectedBy + injectedMessageType` 作为分组键：

- 小结时：同分组最新一条 injected 消息不标 `summarized:true`，更旧的同分组 injected 消息会标记为已小结；
- 筛选时：同分组只保留最新一条；
- 如果历史消息缺少 `injectedMessageType`，实现会回退到内部消息类型、relay purpose、通用 `type` 或 `injectedBy`，以兼容旧数据。

基础裁剪规则（recent window）：

```text
[裁剪] 先执行基础筛选
[裁剪] 取筛选后消息的最后 recentLimit 条
[裁剪] 如果窗口第一条是 assistant，或窗口内没有 user，则尝试从窗口前补最近一条 user 作为 anchor
[裁剪] 如果补 anchor 后超过 recentLimit，再删除回 recentLimit
[裁剪] 最后再执行一次基础筛选
```

#### 4.2.2 插件侧第一轮重组

插件侧 `capabilities/runtime.js -> applyMessageBlocksForBeforeLlmCall(...)` 读取 Agent 侧分块，并调用 Agent 提供的入口分别处理：

```text
[插件侧调用][Agent侧执行] system1 = resolveMessageBlock(
  scope = "system",
  messages = originalSystemBlock,
)

[插件侧调用][Agent侧执行] history1 = resolveMessageBlock(
  scope = "history",
  messages = originalHistoryBlock,
)

[插件侧调用][Agent侧执行] incremental1 = resolveMessageBlock(
  scope = "incremental",
  messages = originalIncrementalBlock,
)
```

插件侧随后第一次写回：

```text
[插件侧] ctx.messages = system1 + history1 + incremental1
[插件侧] ctx.messageBlocks = { system: system1, history: history1, incremental: incremental1 }
```

实现上会原地更新既有 `ctx.messageBlocks` 对象，避免断开与 Agent `loopState.messageBlocks` 的引用关系。

#### 4.2.3 插件侧 capability 注入

capability / hook 运行期间，插件侧可能继续修改 `ctx.messages`：

```text
[插件侧] extraSystemMessages    = 新增且 role 为 system 的消息
[插件侧] extraNonSystemMessages = 新增且 role 非 system 的消息
```

当前 hooks 最终压缩会把这些新增消息归类为：

```text
[插件侧] extraSystemMessages    -> 合并进 system
[插件侧] extraNonSystemMessages -> 合并进 incremental
```

#### 4.2.4 插件侧最终压缩，Agent 侧入口执行过滤/裁剪

插件侧 `core/hooks.js -> compactFinalConversationWindow(...)` 会再次调用 Agent 侧入口：

```text
[插件侧调用][Agent侧执行] systemResolved = resolveMessageBlock(
  scope = "system",
  messages = system1 + extraSystemMessages,
  筛选 = 基础筛选,
  裁剪 = 不做 recent window,
)

[插件侧调用][Agent侧执行] historyResolved = resolveMessageBlock(
  scope = "history",
  messages = history1,
  筛选 = 基础筛选,
  裁剪 = recent(contextWindowRecentMessageLimit), // 默认 20
)

[插件侧调用][Agent侧执行] incrementalResolved = resolveMessageBlock(
  scope = "incremental",
  messages = incremental1 + extraNonSystemMessages,
  筛选 = 基础筛选,
  裁剪 = recent(incrementalRecentMessageLimit || contextWindowRecentMessageLimit), // 默认 20
)

[插件侧调用][Agent侧执行] conversationResolved = resolveMessageBlock(
  scope = "conversation",
  messages = historyResolved + incrementalResolved,
  筛选 = 基础筛选,
  裁剪 = recent(contextWindowRecentMessageLimit), // 默认 20
)
```

插件侧最终写回：

```text
[插件侧] ctx.messages = systemResolved + conversationResolved
[插件侧] ctx.messageBlocks = {
  system: system1 + extraSystemMessages,
  history: history1,
  incremental: incremental1 + extraNonSystemMessages,
}
```

注意：`ctx.messageBlocks.history` 和 `ctx.messageBlocks.incremental` 保留的是可重算源块，而不是最终传模窗口。最终 `ctx.messages` 使用的是 `systemResolved + conversationResolved`。这样即使某条当前轮 harness 注入消息曾在一次 `conversation` recent window 中滑出，只要它仍在源块中、且仍是同 `injectedMessageType` 分组的最新注入消息，小结将工具爆发消息标记为 `summarized:true` 后，下一次压缩仍可把它重新算回窗口；同类型更旧的注入消息会被小结标记/筛选移除。

#### 4.2.5 最终调用模型前的 Agent 侧保护过滤

最终 LLM invoke 前，Agent 侧还会执行：

```text
[Agent侧/最终调用前] finalModelMessages = filterForModelContext(ctx.messages)
```

因此可以把最终上下文精确理解为：

```text
finalModelMessages = filterForModelContext([
  // [插件侧组装] system 部分
  // [Agent侧规则] 筛选 = 基础筛选；裁剪 = 无 recent window
  ...resolveMessageBlock(
    scope = "system",
    messages = originalSystemBlock + extraSystemMessages,
  ),

  // [插件侧组装] conversation 部分
  // [Agent侧规则] 筛选 = 基础筛选；裁剪 = recent(contextWindowRecentMessageLimit)，默认 20
  ...resolveMessageBlock(
    scope = "conversation",
    messages = [
      // [插件侧传入] history 窗口
      // [Agent侧规则] 筛选 = 基础筛选；裁剪 = recent(contextWindowRecentMessageLimit)，默认 20
      ...resolveMessageBlock(
        scope = "history",
        messages = originalHistoryBlock,
      ),

      // [插件侧传入] incremental 窗口
      // [Agent侧规则] 筛选 = 基础筛选；裁剪 = recent(incrementalRecentMessageLimit || contextWindowRecentMessageLimit)，默认 20
      ...resolveMessageBlock(
        scope = "incremental",
        messages = originalIncrementalBlock + extraNonSystemMessages,
      ),
    ],
  ),
])

// [Agent侧最终调用前规则]
// filterForModelContext 只做最终筛选，不做 recent 裁剪：
// - 过滤 summarized:true，current system_context 例外
// - 合法化 assistant tool_calls / tool result pair
// - 孤立 task_summary tool result 转 user [阶段小结] fallback
```

展开成窗口语义：

```text
finalModelMessages
= [Agent侧最终filter](
    [Agent侧filter][插件侧保留] systemBaseFilter(originalSystem + extraSystem)
    + [Agent侧conversation窗口][插件侧最终组装] recentN(
        [Agent侧history窗口] recentN(historyAfterBaseFilter, contextWindowRecentMessageLimit)
        + [Agent侧incremental窗口] recentM(incrementalAfterBaseFilter + extraNonSystem, incrementalRecentMessageLimit)
      , contextWindowRecentMessageLimit)
  )
```

#### 4.2.6 最终上下文中的筛选/裁剪规则标注

```text
[Agent侧输入] originalSystemBlock
  -> [筛选] 基础筛选
  -> [裁剪] 无 recent window
  -> systemResolved

[Agent侧输入] originalHistoryBlock
  -> [筛选] 基础筛选
  -> [裁剪] recent(contextWindowRecentMessageLimit)
  -> historyResolved

[Agent侧输入 + 插件侧新增] originalIncrementalBlock + extraNonSystemMessages
  -> [筛选] 基础筛选
  -> [裁剪] recent(incrementalRecentMessageLimit || contextWindowRecentMessageLimit)
  -> incrementalResolved

[插件侧组装] historyResolved + incrementalResolved
  -> [筛选] 基础筛选
  -> [裁剪] recent(contextWindowRecentMessageLimit)
  -> conversationResolved

[插件侧最终写回] systemResolved + conversationResolved
  -> [Agent侧最终调用前筛选] filterForModelContext(ctx.messages)
  -> finalModelMessages
```

最终上下文里的规则可以简写为：

```text
finalModelMessages
= finalFilter(
    noRecent(baseFilter(system + extraSystem))
    + recentN(
        baseFilter(recentN(baseFilter(history), contextWindowRecentMessageLimit))
        + baseFilter(recentM(baseFilter(incremental + extraNonSystem), incrementalRecentMessageLimit))
      , contextWindowRecentMessageLimit)
  )
```

筛选规则清单：

```text
[筛选: dialog]        injectedMessage/injectedBy 标记的消息按 dialogProcessId 过滤；非 injected 不按 dialogProcessId 删除
[筛选: injected-type] 同一 injectedBy + injectedMessageType 分组只保留最新一条；缺省 type 会按内部类型 / relay purpose / type / injectedBy 回退
[筛选: summarized]    summarized:true 删除；summarized:true 的 current system_context 例外保留
[筛选: tool-pair]     assistant tool_calls 与 tool result 必须成对；孤立普通 tool / assistant tool_call 会被删除
[筛选: task_summary]  孤立 task_summary tool result 转换为 user [阶段小结] 消息保留
[筛选: final]         最终 invoke 前再次执行 filterForModelContext，但不再执行 recent window
```

裁剪规则清单：

```text
[裁剪: system]       不做 recent window
[裁剪: history]      recent(contextWindowRecentMessageLimit)，默认 20
[裁剪: incremental]  recent(incrementalRecentMessageLimit || contextWindowRecentMessageLimit)，默认 20
[裁剪: conversation] recent(contextWindowRecentMessageLimit)，默认 20；输入是 historyResolved + incrementalResolved
[裁剪: anchor]       recent window 内若第一条是 assistant 或没有 user，会尝试从窗口前补最近 user anchor，然后再压回 limit
```

其中：

- `[Agent侧] originalSystemBlock/originalHistoryBlock/originalIncrementalBlock`：由 `buildContextMessageBlocks(...)` 产出并放入 hook context；
- `[Agent侧] resolveMessageBlock(...)`：统一执行 summarized 过滤、dialogProcessId injected 过滤、tool pair 合法化、recent window 等规则；
- `[插件侧] extraSystemMessages`：capability/hook 运行期间新增且 role 为 `system` 的消息；
- `[插件侧] extraNonSystemMessages`：capability/hook 运行期间新增且 role 非 `system` 的消息，当前实现会并入 `incremental`；
- `[Agent侧] baseFilter / finalFilter` 均包含 `summarized:true` 过滤、非法 tool pair 过滤、task_summary tool result fallback 等 `filterForModelContext` 语义；
- `[Agent侧] injected message` 会先按 `dialogProcessId` 过滤，不属于当前链路的 injected message 会被移除；
- `[插件侧+Agent侧] frontendUserMessage` 有 anchor 补回逻辑；普通 harness injected message 没有全保留语义，仍参与 `incremental` 与最终 `conversation` 窗口裁剪。

结论：默认情况下，最终非 system 对话窗口的上限不是 `history 20 + incremental 20`，而是：

```text
[插件侧最终组装][Agent侧窗口裁剪]
conversation = recent20(historyRecent20 + incrementalRecent20)
```

也就是 `history` 与 `incremental` 合计最终仍会被压到 `contextWindowRecentMessageLimit`。

---

## 5) 关键调用点（便于排查）

1. Agent 构建分块：`buildContextMessageBlocks(...)`
2. Hook 透传：`buildHookContext(...).messageBlocks`
3. Agent 注入统一入口：`_createHarnessResolveMessageBlock(...)`
4. 插件重组：`capabilities/runtime.js -> applyMessageBlocksForBeforeLlmCall(...)`
5. hooks 最终压缩：`core/hooks.js -> compactFinalConversationWindow(...)`（最终写回 `system + conversation`）

---

## 6) 常见误区（精简版）

1. **“插件模式会改掉无插件行为”**：不会，无插件仍走原链路。  
2. **“system 也会被 recent 裁剪”**：不会。  
3. **“current user 永远是最终最后一条”**：不保证，插件可后置注入。  
4. **“只看最后一次日志就能还原全部裁剪过程”**：不行，历史通常是两段处理后才进入最终请求。
5. **“最终是 history 窗口 + incremental 窗口相加”**：不是。当前最终 `conversation` 会把 `history + incremental` 再按 `contextWindowRecentMessageLimit` 合并裁剪一次。
6. **“当前轮 harness 注入消息不会被裁剪”**：不是。它会按 `injectedMessageType` 同类型只保留最新一条，也仍会参与 `incremental` 和最终 `conversation` recent window。
