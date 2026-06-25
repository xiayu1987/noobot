# 模型上下文最终消息规则

本文档是模型请求上下文的单一规则来源。旧的上下文/模型消息流文档已删除，后续上下文相关改动以本文为准。

## 1. 主流程最终给模型的消息

主流程最终给模型的消息按以下三段拼接：

```text
finalMessages = systemMessages + historyMessages + incrementalMessages
```

### 1.1 systemMessages

来源：

1. 主流程构建的 system 消息；
2. 插件注入的 system 消息。

规则：

- system 不从 session 历史消息中读取；
- 筛选：保留未被小结移除的 system 消息；当前轮 system context 即使带有小结标记也保留；
- 裁剪：无；
- 顺序：实际顺序。

### 1.2 historyMessages

来源：历史消息。

规则：

- 筛选：只读取带 `dialogProcessId/dialogId` 的历史消息，按该 id 分组；没有 dialog id 的消息不进入 history。
- 每个入选 dialog 组保留组内所有未小结非 system 消息；中间的插件规划、跟进、工具结果等只要 `summarized !== true`，都属于该 history 组的一部分，不得被二次裁剪丢弃。
- 最终模型发送前的通用过滤只处理 `summarized` 与非法 tool/tool_call 配对，不得对 history 中的未小结注入消息执行“同类型只保留最新一条”去重；该 latest-only 策略只属于小结/压缩标记路径。
- 裁剪：按 dialog 组首次出现顺序，只保留最近 3 个 dialog 组。
- 顺序：dialog 组之间按首次出现顺序；组内保持原始自然顺序。
- 执行顺序：先筛选，再裁剪。

### 1.3 incrementalMessages

来源：当前增量消息，包括：

1. 当前用户发送消息；
2. 模型返回；
3. 工具调用与工具结果；
4. 插件注入增量；
5. 主流程注入增量。

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

## 3. harness 主流程 messageBlocks 边界

harness 在主流程 `before_llm_call` 中可接收 agent 侧拆好的 `messageBlocks`：

```text
messageBlocks = {
  system,
  history,
  incremental
}
```

边界规则：

- `system` 只走 system 规则；
- `history` 只走 history 规则，必须与第 1.2 节主流程历史规则一致；
- `incremental` 只走 incremental 规则；
- harness 注入必须按类别写入对应 block：system 注入写 `system`，历史类写 `history`，当前轮注入写 `incremental`；
- harness 不得把 `history` 与 `incremental` 合并为 conversation 后再裁剪或重排；
- 最终拼接仍为：

```text
finalMessages = system + history + incremental
```

因此，history 中已入选的 dialog 组不能被插件侧二次裁剪；incremental 只允许按现有小结标记过滤，不得改变最终三段大顺序。

## 4. 未启用 harness 时

未启用 harness 时，主流程仍按本文第 1 节生成最终模型消息；不依赖 harness 插件侧压缩逻辑。
