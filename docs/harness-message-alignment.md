# Harness 插件模型消息与 Agent 主流程对齐约定

本文档记录 harness 插件调用模型时与 agent 主流程消息的对齐规则，避免插件侧复制、重建或误改 agent 的消息策略。

## 0. 一眼看懂：`agent.main` 最终消息怎么来的

最简公式：

```text
基础 messages（buildContextMessages 生成）
= 系统上下文 system messages（不参与历史裁剪）
+ 历史消息 history（第一次 session 筛选/裁剪 + 第二次主模型筛选/裁剪）
+ 当前用户消息 currentUserMessage（不参与历史裁剪）
+ 当前用户元信息 [用户元信息]（不参与历史裁剪）

实际发给模型的 messages
= before_llm_call hook 对基础 messages 的前置/后置/替换改写结果
```

硬规则（按代码执行顺序）：

| 规则 | 实际行为 |
| --- | --- |
| 基础数组构建 | `buildContextMessages()` 先产出基础数组，顺序固定：`system -> effectiveHistoryMessages -> currentUserMessage -> currentUserMeta` |
| hook 改写时机 | `before_llm_call` 在模型调用前拿到同一个 `messages` 数组，可 `unshift/push/splice` 改写 |
| 最终请求顺序 | `invokeLlm.invoke(filterForModelContext(messages), ...)`；最终顺序以 hook 改写后的 `messages` 为准 |
| currentUser 两条消息位置 | 只保证是“基础数组末尾”，不保证是“最终请求末尾” |
| 为什么日志里 currentUser 后面还有消息 | 因为 hook 在 `before_llm_call` 做了 `append/push` 注入 |

### 0.1 无 hook 与有 hook 的实际顺序（分开看）

| 场景 | 最终请求顺序（按实际调用） | 说明 |
| --- | --- | --- |
| 无 `before_llm_call` hook 改写 | `systemContext -> effectiveHistoryMessages(按 role 转换) -> currentUserMessage -> currentUserMeta` | 最终请求顺序等于 `buildContextMessages()` 产出的基础顺序（之后仅做 `filterForModelContext`） |
| 有 `before_llm_call` hook 改写 | `hook 改写后的 messages 数组顺序` | hook 可 `prepend/append/replace/splice`，最终以 `invokeLlm.invoke(filterForModelContext(messages), ...)` 时的 `messages` 为准 |

无 hook 最小模板：

```text
base = buildContextMessages(...)
final = filterForModelContext(base)
invoke(final)
```

有 hook 最小模板：

```text
base = buildContextMessages(...)
run before_llm_call hooks (mutate base in-place)
final = filterForModelContext(base)
invoke(final)
```

按实际执行顺序看：

| 阶段 | 消息段 | 来源 | 是否过滤 | 是否裁剪 | 最终位置 | 典型内容 |
| --- | --- | --- | --- | --- | --- | --- |
| A | 第一次历史处理 | 完整 session 记录 | 是：旧 dialog injected、`summarized:true`、非法 tool pair | 是：completed/running 范围或 recent fallback（默认 20） | 不直接发模型，先写入 `agentContext.payload.messages.history` | 真实历史问答、当前 dialog 的 harness relay |
| B | 第二次历史处理 | `agentContext.payload.messages.history` | 是：旧 dialog injected、`summarized:true`、非法 tool pair | 是：`context.main_model_recent_limit`（默认 15，若开启） | 拼到 system 后面 | `effectiveHistoryMessages` |
| C | 基础 messages 拼接 | `buildContextMessages()` | history 已在 B 处理；system/current 不按 history 规则裁剪 | 不再裁剪 | 基础顺序：`system -> history -> 当前用户 -> 当前用户元信息` | hook 执行前的主模型基础 messages |
| D | `before_llm_call` hook 改写 | 插件/能力注入到 `ctx.messages` | 模型调用前还会整体过一次 `filterForModelContext(messages)` | 通常不按 recent limit 再裁剪 | 可能 `prepend` 到最前，也可能 `append` 到当前用户元信息之后 | `<!-- noobot-harness-policy -->...`、`[来自harness外部模型输出/planning]`、强制验收提示等 |
| E | 实际模型请求 | hook 后的 `messages` | 最后再过滤 `summarized:true` 与非法 tool pair | 不做新的 recent window | 请求体里的 `messages`，顺序以 hook 后数组为准 | 你在 model-proxy log 里看到的最终顺序 |

因此，如果只看模型请求日志，常见最终形态是：

```text
[可选] before_llm_call 前置注入消息
系统上下文 system messages
第二次裁剪后的历史消息
  - 历史 assistant/tool/user
  - 每条历史 user 派生的 [用户元信息]
当前用户消息
当前用户派生的 [用户元信息]
[可选] before_llm_call 后置注入消息
```

注意：如果存在后置注入消息，例如 harness 在 `before_llm_call` 阶段把 separate model 的 planning 结果 append 到 `ctx.messages`，那么日志里当前用户元信息后面还会继续出现这些注入消息。

最小可验证模板：

```text
base = buildContextMessages(...)
# base 最后两条通常是：currentUserMessage, currentUserMeta

run before_llm_call hooks
# hooks may mutate base in-place: unshift/push/splice/replace

final = filterForModelContext(base)
invoke(final)
```

关键点：

| 误区 | 实际情况 |
| --- | --- |
| “系统运行信息也会被 15 条裁剪” | 不会。`agentContext.payload.messages.system[]` 直接拼到最前面，不参与 history recent limit。 |
| “当前用户消息属于第二次裁剪窗口” | 不属于。第二次裁剪只处理 `agentContext.payload.messages.history`；当前用户消息在基础 messages 的 history 之后追加。 |
| “当前用户消息和元信息一定是最终最后两条” | 不一定。它们只是 `buildContextMessages()` 基础 messages 的最后两条；`before_llm_call` 后置注入可以继续追加到它们后面。 |
| “hook 注入消息一定在 system 后面” | 不一定。`before_llm_call` 的 `prepend` 注入会 `messages.unshift(...)`，所以可出现在 system 前面；`append` 注入则可出现在当前用户元信息之后。 |
| “旧 dialog 的 harness relay 第二次会过滤，所以第一次无所谓” | 不对。第一次如果没过滤，旧 relay 会先占 recent 名额，真实历史被挤掉后第二次无法恢复。 |

## 1. Agent 主流程消息策略

Agent 主流程给模型的消息以当次 context 构建结果为准。

核心原则：

1. context 中已经存在的消息，就是 agent 主流程当前准备给模型的消息基础。
2. agent 主流程有自己的消息策略，包括但不限于：
   - 过滤 `summarized: true` 的历史消息；
   - 按 `dialogProcessId` 过滤不属于当前对话链路的 injected 消息；
   - 保持 tool-call / tool-result pair 合法性；
   - 构建当前用户消息及用户元信息消息。
3. agent 主模型传模链路支持 recent window 配置，默认启用。
4. agent 主模型 recent window 配置项：
   - `context.main_model_recent_window`（默认 `true`）
   - `context.main_model_recent_limit`（默认 `15`）
5. 插件不得自己复制一套 agent 主流程消息构建逻辑。
6. 插件只能调用 agent 注入给插件的方法来应用 agent 消息策略。

## 1.1 确定调用链（continue 模式）

为避免“可能/大概”式描述，下面是 continue 模式下的确定调用顺序：

1. `SessionExecutionRunner` 根据 session 是否存在设置 `mode=continue`。
2. `ContextBuilder.buildContinueContext({ dialogProcessId })` 调用 `_resolveSessionRecords({ dialogProcessId })` 拉取会话记录。
3. `_resolveSessionRecords -> sessionManager.getContextRecords({ currentDialogProcessId: dialogProcessId })`，由 session context service 选择记录范围（completed/running/recent）。
4. `buildContinueContext` 对记录做会话级标准化后，写入 `agentContext.payload.messages.history`。
5. 真正传模前，`buildContextMessages` 会再次调用 `resolveModelContextMessages` 得到 `effectiveHistoryMessages`，再组装最终模型 `messages`。

结论：continue 模式通常是“两段过滤/规范化”，并且 `agent.main` 主链路这一段会按 `context.main_model_recent_window/main_model_recent_limit` 配置决定是否做 recent window 截断。

## 1.2 Agent 侧两次历史消息过滤/裁剪规则

Agent 侧 continue 模式有两次会话历史处理，不能只看最后一次模型请求日志。

### 第一次：构建 `agentContext.payload.messages.history`

入口链路：

| 顺序 | 调用点 | 输入/输出 | 说明 |
| --- | --- | --- | --- |
| 1 | `ContextBuilder.buildContinueContext({ dialogProcessId })` | 当前 turn 的 `dialogProcessId` | continue 模式入口 |
| 2 | `_resolveSessionRecords({ dialogProcessId })` | `sessionId + dialogProcessId` | 拉取会话记录前保留当前 dialog 标识 |
| 3 | `sessionManager.getContextRecords({ currentDialogProcessId: dialogProcessId })` | `currentDialogProcessId` | 传给 session facade |
| 4 | `SessionContextService.getContextRecords(...)` | 原始 session messages | 选择 completed/running/recent 范围并规范化 |
| 5 | `ContextBuilder._normalizeSessionRecordsForConversation(...)` | session context service 返回值 | 转为 conversation messages，写入 `agentContext.payload.messages.history` |

范围选择规则：

| 优先级 | 配置/条件 | 取值范围 | 是否使用 `recentMessageLimit` |
| --- | --- | --- | --- |
| 1 | `useLastCompletedTaskRange !== false` 且能找到 `taskStatus === "completed"` | 最近 completed task 之后到结尾 | 否 |
| 2 | `useLastRunningTaskRange !== false` 且能找到 `taskStatus === "start"` | 最近 running task 之后到结尾 | 否 |
| 3 | fallback | recent window | 是，`session.recentMessageLimit` / `session.recent_message_limit`，默认 `20` |

第一次过滤/归一化规则：

| 规则 | 行为 | 关键点 |
| --- | --- | --- |
| 当前 dialog 过滤 | `currentDialogProcessId` 必须从当前 turn 传入 session context service | 过滤发生在第一次裁剪前 |
| injected 消息过滤语义 | 非 injected 消息保留；injected 消息只保留 `dialogProcessId === currentDialogProcessId` 的消息 | 不是删除所有 injected 消息 |
| 空 `currentDialogProcessId` | 如果没有传入，则 injected 消息不会按 dialog 被剔除 | 旧 dialog harness relay 会参与 recent 计数 |
| summarized 过滤 | 移除 `summarized: true` | 由 `filterForModelContext()` 执行 |
| tool pair 过滤 | 移除非法 tool-call / tool-result pair | 防止孤立 tool result 进入模型上下文 |
| user anchor | recent/startIndex 裁剪后，如果窗口开头是 assistant 或窗口内没有 user，会尝试向前补一个 user anchor | 补完后若超限，会删掉 anchor 后面的第一条以保持 limit |

过滤/归一化顺序大体为：

```text
原始 session messages
  -> 按 currentDialogProcessId 过滤旧 dialog injected 消息
  -> normalizeMessage（如果调用方传入）
  -> shouldKeepMessage（如果调用方传入）
  -> filterForModelContext：
       - 移除 summarized: true
       - 移除非法 tool-call / tool-result pair
  -> recent window 或 startIndex/limit 窗口
  -> 必要时补一个前置 user anchor
  -> 再次执行 filterForModelContext
  -> 写入 agentContext.payload.messages.history
```

注意：

- completed/running 范围模式通常不按 `recentMessageLimit` 裁剪，而是按最近任务状态定位 `startIndex` 后取到结尾；
- recent fallback 才按 `recentMessageLimit` 做最近 N 条裁剪；
- `ContextBuilder._normalizeSessionRecordsForConversation()` 还会做一次会话级 `filterSummarizedMessages + normalizeContextWindow`，但此时旧 dialog injected 消息应该已经在 session context service 层被过滤掉。

### 第二次：真正发给主模型前构建 `effectiveHistoryMessages`

入口链路：

| 顺序 | 调用点 | 输入/输出 | 说明 |
| --- | --- | --- | --- |
| 1 | `buildContextMessages(agentContext, { currentUserMessage })` | `agentContext.payload.messages.system/history` | 主模型传模前入口 |
| 2 | `resolveDialogProcessId(...)` | runtime + history | 得到 `resolvedDialogProcessId` |
| 3 | `resolveModelContextMessages(...)` | `sourceMessages = agentContext.payload.messages.history` | 得到 `effectiveHistoryMessages` |
| 4 | 遍历 `effectiveHistoryMessages` | 收集 `knownHistoryToolCallIds` | 用于二次保护 tool result |
| 5 | 拼接最终 `out` | LangChain message 数组 | 后续交给模型适配层 |

第二次过滤/裁剪规则：

| 规则 | 行为 | 默认/来源 |
| --- | --- | --- |
| 数据源 | 只使用第一次已经写入的 `agentContext.payload.messages.history` | 不会回到完整 session 文件重新取 |
| dialog 过滤 | 再次按 `resolvedDialogProcessId` 过滤 injected 消息 | `resolveDialogProcessId(...)` |
| summarized 过滤 | 再次过滤 `summarized: true` | `filterForModelContext()` |
| tool pair 过滤 | 再次过滤非法 tool-call / tool-result pair | `filterForModelContext()` |
| 主模型 recent window | `context.main_model_recent_window !== false` 时启用 | 默认 `true` |
| 主模型 recent limit | `context.main_model_recent_limit` | 默认 `15` |
| 当前用户消息 | 在历史处理后追加 | 不参与 history recent window 计数 |
| 用户元信息 | 每个 user/history user relay 以及当前用户消息后追加一条 `[用户元信息]` | 不参与 history recent window 计数（当前用户部分） |

关键结论：

- 第一次裁剪决定“哪些 session 历史能进入 `agentContext.payload.messages.history`”；
- 第二次裁剪决定“哪些 history 最终进入本次 `agent.main` 模型请求”；
- 如果第一次没有传 `currentDialogProcessId`，旧 dialog 的 harness 注入消息会在第一次 recent window 中占位；第二次即使能过滤掉它们，也无法恢复已经在第一次被挤掉的真实历史消息。

## 1.3 Agent 主模型最终消息拼接顺序

`buildContextMessages()` 生成 hook 执行前的基础消息。基础顺序是固定的：**system context -> 第二次裁剪后的 history -> 当前用户消息 -> 当前用户元信息**。实际模型请求还要看 `before_llm_call` hook 对 `ctx.messages` 的前置/后置改写。

### 1.3.1 最终消息总顺序

| 最终顺序 | 来源 | 生成方式 | 最终 role/type | 是否参与第一次 session 裁剪 | 是否参与第二次 main recent 裁剪 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `agentContext.payload.messages.system[]` | 每个字符串转为 `new SystemMessage(content)` | `system` | 否 | 否 | 包括 base prompt、系统运行环境、场景、服务、目录等系统上下文；保持原数组顺序 |
| 2 | `effectiveHistoryMessages[]` 中的 `role=system` | `new SystemMessage(msg.content)` | `system` | 是 | 是 | 历史里如果存在 system 消息，会按历史位置插入 |
| 3 | `effectiveHistoryMessages[]` 中的 `role=assistant` | `new AIMessage({ content, tool_calls })` | `assistant` | 是 | 是 | `content` 优先用 `rawModelContent`，否则用 `content` |
| 4 | `effectiveHistoryMessages[]` 中的 `role=tool` | `new ToolMessage({ tool_call_id, content })` | `tool` | 是 | 是 | 仅当 `tool_call_id` 在历史 assistant tool-call id 集合中才保留 |
| 5 | `effectiveHistoryMessages[]` 中的其他/user 消息 | `buildHumanMessagesForUser(msg, fallbackUserMeta)` 第一条 | `user` / `HumanMessage` | 是 | 是 | 包括真实用户历史、harness relay user、用户元信息历史等 |
| 6 | 同一条 history user 消息派生 | `buildHumanMessagesForUser(...)` 第二条 | `user` / `HumanMessage` | 派生自历史消息 | 派生自第二次保留下来的 user 消息 | 内容为 `[用户元信息]...[/用户元信息]` |
| 7 | `currentUserMessage` | `buildHumanMessagesForUser({ frontendUserMessage: true, ... })` 第一条 | `user` / `HumanMessage` | 否 | 否 | 当前 turn 用户输入，追加在所有基础 history 之后；hook 后置注入可能排在它后面 |
| 8 | 当前用户消息派生 | `buildHumanMessagesForUser(...)` 第二条 | `user` / `HumanMessage` | 否 | 否 | 当前 turn 的 `[用户元信息]`；是基础 messages 的末尾，不保证是实际请求的末尾 |
| 9 | `before_llm_call` 后置注入 | hook 修改 `ctx.messages.push(...)` | 取决于注入消息 | 否 | 否 | 如果存在 append 注入，会出现在当前用户元信息之后 |

### 1.3.2 两次历史处理与最终拼接的关系

| 阶段 | 输入 | 输出 | 会过滤什么 | 会裁剪什么 | 输出被谁使用 |
| --- | --- | --- | --- | --- | --- |
| 第一次：session history 构建 | 完整 session 文件里的 turns/messages | `agentContext.payload.messages.history` | 旧 dialog injected、`summarized: true`、非法 tool pair | completed/running 范围或 recent fallback（默认 20） | 第二次传模前处理 |
| 第二次：主模型 history 构建 | `agentContext.payload.messages.history` | `effectiveHistoryMessages` | 旧 dialog injected、`summarized: true`、非法 tool pair | `context.main_model_recent_limit`（默认 15，若 recent window 开启） | 最终模型消息拼接 |
| 最终拼接：system | `agentContext.payload.messages.system` | `SystemMessage[]` | 不在这里过滤 | 不在这里裁剪 | 最终 `messages` 开头 |
| 最终拼接：history | `effectiveHistoryMessages` | `SystemMessage/AIMessage/ToolMessage/HumanMessage` | tool result 再按 `knownHistoryToolCallIds` 保护 | 不再裁剪 | 接在 system 后 |
| 最终拼接：当前用户 | `currentUserMessage` + runtime meta | 当前用户 `HumanMessage` + `[用户元信息]` | 空字符串不追加 | 不裁剪 | 基础 messages 末尾；实际请求中后面可能还有 hook append 消息 |
| Hook 后置注入 | `before_llm_call` 修改后的 `ctx.messages` | 追加 user/system 等消息 | 最后调用前会整体 `filterForModelContext` | 不做新的 recent window | 实际请求末尾可能是这些消息 |

### 1.3.3 history 消息到最终消息的转换规则

| history `role` | 转换结果 | 附加处理 | 备注 |
| --- | --- | --- | --- |
| `system` | `SystemMessage(msg.content)` | 无 | 按 history 位置进入，不会并入 system context 数组 |
| `assistant` | `AIMessage({ content, tool_calls })` | `tool_calls` 会从 OpenAI/function-call 格式转为 LangChain tool call 格式 | `content` 优先 `rawModelContent` |
| `tool` | `ToolMessage({ tool_call_id, content })` | 如果 `tool_call_id` 不在本次保留的 assistant tool-call id 集合里，会跳过 | 防止孤立 tool result |
| `user` 或其他 | 两条 `HumanMessage`：原内容 + `[用户元信息]` | 如果 `frontendUserMessage=true`，第一条带 `additional_kwargs.frontendUserMessage=true` | harness relay user 也走这条规则 |

### 1.3.4 `[用户元信息]` 内容来源

| 字段 | 优先来源 | fallback | 说明 |
| --- | --- | --- | --- |
| `userName` | `msg.userName` | `runtime.userId` | 当前用户标识 |
| `sessionId` | `msg.sessionId` | `runtime.systemRuntime.sessionId` | 当前 session |
| `parentSessionId` | `msg.parentSessionId` | `runtime.systemRuntime.parentSessionId` | 父 session |
| `dialogProcessId` | `msg.dialogProcessId` / `msg.dialogId` 等 | `resolvedDialogProcessId` | 用于后续 dialog 过滤 |
| `parentDialogProcessId` | `msg.parentDialogProcessId` | `runtime.systemRuntime.parentDialogProcessId` | 父 dialog |
| `attachments` | `msg.attachmentMetas` | `runtime.attachmentMetas` | 会展开为附件 id、路径、解析结果等 |

### 1.3.5 对日志中 `agent.main` 请求的阅读方式

| 日志中看到的片段 | 来源阶段 | 解释 |
| --- | --- | --- |
| 前几条 `system` | `agentContext.payload.messages.system` | 系统上下文，不参与 history recent limit |
| 历史 assistant/user/tool | 第二次处理后的 `effectiveHistoryMessages` | 已经过两次过滤/裁剪 |
| harness relay user，如 `[来自harness外部模型输出/...]` | 第一次 session history 或当前 turn 注入 | 只保留当前 dialog 的 injected；旧 dialog 应在第一次/第二次过滤掉 |
| 每条用户消息后的 `[用户元信息]` | `buildHumanMessagesForUser()` 派生 | 不是用户真实输入，而是 agent 自动追加的元信息 |
| 当前用户消息 | `currentUserMessage` | 当前 turn 输入，不参与两次 history 裁剪；在基础 messages 中靠后 |
| 当前 `[用户元信息]` | 当前用户消息派生 | 包含当前 session/dialog/attachments；在基础 messages 中跟随当前用户消息 |
| 当前用户元信息后面的消息 | `before_llm_call` 后置注入 | 例如 planning relay、强制提示等 append 消息；说明实际请求已被 hook 改写 |

## 1.4 Agent 与插件裁剪/过滤差异

两边使用同一个底层函数 `resolveModelContextMessages()`，但参数不同，因此行为不同。

| 项目 | agent 侧主模型 | 插件侧模型 |
| --- | --- | --- |
| 调用位置 | `agent/core/context/message-builder.js` | `session-execution-engine.js` 注入给 harness 的 `resolveModelMessages` |
| 底层方法 | `resolveModelContextMessages()` | `resolveModelContextMessages()` |
| mode | `"agent"` | `"agent"` |
| 是否 recent window | 是（可配置） | 是 |
| recentLimit | 第二次传模前使用 `context.main_model_recent_limit`（默认 15）；第一次 session recent fallback 使用 `session.recent_message_limit`（默认 20） | `plugins.harness.contextWindowRecentMessageLimit` / `WORKFLOW_PARAMS.contextWindow.recentMessageLimit`（默认 20） |
| startIndex / limit | 默认 `0 / Infinity` | 不用，改用 recent window |
| summarized 过滤 | 会过滤 | 会过滤 |
| harness injected 按 dialog 过滤 | 会过滤 | 会过滤 |
| tool_call pair 合法性过滤 | 会过滤 | 会过滤 |
| 消息标准化 | 不传 `normalizeMessage` | 传 `normalizeMessageForHarness` |
| 后续能力改写 | 无 | 有，`buildCapabilityModelMessages()` |
| 最终效果 | 尽量保留完整 agent 历史 | 只取最近窗口 + 能力专用上下文 |

补充说明：

1. agent 侧是“两次过滤/裁剪”：第一次取 session history，第二次传主模型前构建 `effectiveHistoryMessages`。
2. 插件侧是“recent window 截断 + 过滤 + 能力改写”。
3. 插件侧若出现“工具调用看不全”，常见原因是 recent window 截断后，tool-call pair 在合法性过滤阶段被移除。

## 2. 小结后的 agent 主流程消息规则

小结完成后，agent 主流程会把已被小结覆盖的当前阶段消息标记为：

```json
{ "summarized": true }
```

下次 agent 构建 context 时：

1. `summarized: true` 的普通历史消息不再传给模型。
2. 小结工具调用本身要保留。
3. 小结工具返回本身要保留。
4. 插件注入的 `user` 消息本来不属于被 summary policy 标记的 assistant/tool 旧消息，因此不应该因为 summarized 过滤而被移除。

换句话说，小结后的主流程模型消息应当表现为：

- 被小结覆盖的旧 assistant/tool 过程消息消失；
- 小结工具调用和小结工具结果仍保留；
- 插件注入的 user relay 消息仍保留；
- 新的当前用户消息及用户元信息按 agent 主流程规则出现。

## 3. 插件模型请求的基础消息来源

Harness 插件所有 separate model 流程都应使用同一个基础消息入口：

```js
resolveCapabilityModelMessages(meta, { ctx, purpose })
```

该函数的职责只有一个：

1. 取当前 hook context 里的消息，例如 `ctx.messages`；
2. 调用 agent 注入的 `meta.harness.resolveModelMessages(...)`；
3. 返回 agent 策略处理后的消息。

插件不应该：

- 直接从 `agentContext.payload.messages.system/history` 自己拼 agent 主流程消息；
- 自己实现 summarized 过滤；
- 自己实现 recent window；
- 自己实现 tool-call pair 修正。

这些策略属于 agent。

## 4. Summary、Planning Revision、Planning Refinement 的消息关系

这是容易误解的关键点。

当 harness separate model 生成小结后：

1. `summary` 请求模型时使用一份基础 `modelMessages`。
2. 小结完成后会进行 `planning_revision`。
3. 如果 revision 成功，还可能进行 `planning_refinement`。

要求：

- `planning_revision` 给模型的基础消息应与刚才 `summary` 给模型的基础消息保持一致；
- `planning_refinement` 给模型的基础消息也应与该 summary/revision 链路使用的基础消息保持一致；
- 不应因为 summary 完成后立即标记 summarized，就让 `planning_revision` 或 `planning_refinement` 使用另一份重新过滤后的基础消息。

也就是说，小结后的计划修正/细化不是“下一轮 agent 主流程请求”，而是同一条插件内部链路的后续模型请求，应沿用 summary 那次的上下文基础。

## 5. Planning Revision / Refinement 的结果注入规则

所有 harness separate model 流程都有同一条总规则：

> 只要插件单独请求了模型，模型返回结果就必须注入/relay 回 agent 主流程，成为 agent 可见的 user 消息。

这条规则适用于：

- `planning`
- `summary`
- `guidance`
- `planning_revision`
- `planning_refinement`
- `planning_json_repair`
- `acceptance_semantic_validation`

其中 `planning_revision` 和 `planning_refinement` 模型返回后，插件还需要额外做两件事：

1. 解析模型返回，更新 harness bucket 中的计划状态；
2. 将对 agent 主流程有用的结果注入为 agent 可见的 user 消息。

结果注入应通过统一 helper 完成，例如：

```js
relaySeparateModelOutputAsUserMessage(ctx, {
  purpose: "next_phase_plan",
  content: buildNextPhaseRelayContent(...),
  dedupe: true,
});
```

或 refinement：

```js
relaySeparateModelOutputAsUserMessage(ctx, {
  purpose: "next_phase_plan_refinement",
  content: buildNextPhaseRelayContent(...),
  dedupe: true,
});
```

注入目标要求：

- 当前 agent 主流程后续模型调用应可见；
- 当前 turn 持久化后，下次 agent 主流程构建 context 时也应可见；
- 如果因为 tool-call continuity 保护不能直接追加到 `ctx.messages`，也必须明确记录注入目标和原因，不能静默丢失。

即使模型返回结果后续被内部解析、修复或判定为无效，也应 relay 原始模型返回或修复后的模型返回，方便 agent 主流程理解插件侧发生了什么。

## 6. 验证点

排查时按以下顺序看日志和代码：

1. `harness.summary` 请求中的 `messages` 是什么；
2. `harness.planning_revision` 请求中的基础 `messages` 是否与 summary 那次一致，只是末尾 task prompt 不同；
3. `harness.planning_refinement` 请求中的基础 `messages` 是否与 summary/revision 链路一致；
4. summary 完成后，agent 主流程下一次 `agent.main` 请求是否仍包含本应 summarized 的旧 assistant/tool 过程消息；
5. planning_revision / refinement 成功后，agent 主流程后续 `agent.main` 请求是否包含对应 relay user 消息；
6. 如果不包含，检查 relay 是否被 dedupe、turn ended、tool-call continuity 或 target fallback 拦截。

## 7. 当前需要定位的两个问题

### 问题 A：summary 后 agent 主流程仍带旧消息

预期：

- 被小结覆盖的旧 assistant/tool 过程消息应标记为 `summarized: true`；
- 下次 agent context 构建时这些消息不再进入模型；
- 但小结工具调用和小结工具返回仍保留。

需要定位：

- summarized 标记是否落到了 agent 主流程后续 context 使用的数据源；
- 是否只标记了临时 `ctx.messages`，没有标记 current turn store 或 session history；
- agent 主流程实际 context 构建是否读取了已标记的数据。

### 问题 B：planning_revision / refinement 结果未注入 agent 主流程

预期：

- revision/refinement 模型结果解析并 apply 成功后，应 relay 为 user 消息；
- relay 消息应进入 agent 主流程可见消息集合；
- 后续 agent.main 请求应能看到该 user relay。

需要定位：

- 模型结果是否解析成功并 apply；
- relay helper 是否被调用；
- relay helper 是否因 dedupe、turn ended、tool-call continuity 被跳过；
- relay 注入是否只进入临时 `ctx.messages`，没有进入最终持久化的 current turn messages。
