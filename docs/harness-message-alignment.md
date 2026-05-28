# Harness 插件模型消息与 Agent 主流程对齐约定

本文档记录 harness 插件调用模型时与 agent 主流程消息的对齐规则，避免插件侧复制、重建或误改 agent 的消息策略。

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
2. `ContextBuilder.buildContinueContext` 调用 `_resolveSessionRecords` 拉取会话记录。
3. `_resolveSessionRecords -> sessionManager.getContextRecords`，由 session context service 选择记录范围（completed/running/recent）。
4. `buildContinueContext` 对记录做会话级标准化后，写入 `agentContext.payload.messages.history`。
5. 真正传模前，`buildContextMessages` 会再次调用 `resolveModelContextMessages` 得到 `effectiveHistoryMessages`，再组装最终模型 `messages`。

结论：continue 模式通常是“两段过滤/规范化”，并且 `agent.main` 主链路这一段会按 `context.main_model_recent_window/main_model_recent_limit` 配置决定是否做 recent window 截断。

## 1.2 Agent 与插件裁剪/过滤差异

两边使用同一个底层函数 `resolveModelContextMessages()`，但参数不同，因此行为不同。

| 项目 | agent 侧主模型 | 插件侧模型 |
| --- | --- | --- |
| 调用位置 | `agent/core/context/message-builder.js` | `session-execution-engine.js` 注入给 harness 的 `resolveModelMessages` |
| 底层方法 | `resolveModelContextMessages()` | `resolveModelContextMessages()` |
| mode | `"agent"` | `"agent"` |
| 是否 recent window | 是（可配置） | 是 |
| recentLimit | `context.main_model_recent_limit`（默认 15） | `session.recent_message_limit`（默认 20） |
| startIndex / limit | 默认 `0 / Infinity` | 不用，改用 recent window |
| summarized 过滤 | 会过滤 | 会过滤 |
| harness injected 按 dialog 过滤 | 会过滤 | 会过滤 |
| tool_call pair 合法性过滤 | 会过滤 | 会过滤 |
| 消息标准化 | 不传 `normalizeMessage` | 传 `normalizeMessageForHarness` |
| 后续能力改写 | 无 | 有，`buildCapabilityModelMessages()` |
| 最终效果 | 尽量保留完整 agent 历史 | 只取最近窗口 + 能力专用上下文 |

补充说明：

1. agent 侧是“过滤优先 + 可配置 recent window 截断（默认启用）”。
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
