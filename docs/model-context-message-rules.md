# 模型上下文最终消息规则

本文档是模型请求上下文的单一规则来源。旧的上下文/模型消息流文档已删除，后续上下文相关改动以本文为准。

## 1. 主流程最终给模型的消息

主流程最终给模型的消息按以下三段拼接：

```text
finalMessages = systemMessages + historyMessages + incrementalMessages
```

### 1.1 systemMessages

来源：

1. 主流程 system 消息；
2. 插件注入的 system 消息。

规则：

- 筛选：保留未被小结移除的 system 消息；当前轮 system context 即使带有小结标记也保留；
- 裁剪：无；
- 顺序：实际顺序。

### 1.2 historyMessages

来源：历史消息。

规则：

- 筛选：按 `dialogProcessId/dialogId` 分组；每个相同 dialog id 只保留：
  1. 第一条实际用户消息；
  2. 最后一条模型返回消息。
- “实际用户消息”指用户真实输入，不包含用户元信息、插件注入消息、内部恢复消息等辅助上下文。
- 裁剪：筛选后只保留最近 10 条消息。
- 顺序：实际顺序。
- 执行顺序：先筛选，再裁剪。

### 1.3 incrementalMessages

来源：当前增量消息，包括：

1. 工具调用增量；
2. 插件注入增量；
3. 主流程注入增量。

规则：

- 筛选：只保留没有标记为已小结的消息；harness 小结标记规则不变，agent 侧小结标记规则不变；
- 裁剪：无；
- 顺序：实际顺序。
- 执行顺序：先筛选，再裁剪（本段无裁剪）。

## 2. harness 插件非主流程模型请求上下文

harness 插件给非主流程模型请求的上下文原先第 1 段是“最近 20 条 agent 上下文”。现在改为：

```text
1. 和主流程最终给模型的消息一致的 agent 上下文
2. system: summary reports，如果有
3. system: main plan context
4. system: previous phase acceptance reports，如果有
5. user: phase acceptance request
6. user: phase acceptance responsibility constraint
```

注意：

- 只有第 1 段改变；后续 capability/acceptance 自己追加的 summary、plan、request、constraint 顺序与职责不变。
- harness 侧消息转换规则不变：例如 assistant tool_calls 仍转换为语义 user 消息，tool role 仍转换为 assistant 消息。
- 筛选、裁剪、拼接规则都由 agent 侧完成，并通过注入方法提供给插件侧；插件侧只调用注入方法，不自行决定 agent 上下文窗口。
- harness 小结标记规则不变；agent 侧小结标记规则不变。

## 3. 未启用 harness 时

未启用 harness 时，主流程仍按本文第 1 节生成最终模型消息；不依赖 harness 插件侧压缩逻辑。
