# 插件参与模式：模型消息流（Agent + 插件侧）

本文档描述 **插件参与时** 的最终传模消息如何生成，以及与 Agent 原生模式的关键差异。

## 1) 一眼看懂

```text
Agent 先产出 messageBlocks:
  system（不参与历史裁剪）
  history（统一过滤+裁剪）
  incremental（当前用户 + 插件注入增量 + 自身增量，统一过滤+裁剪）

插件在 before_llm_call 基于 messageBlocks 重组 ctx.messages
最终调用前仍会执行 filterForModelContext(messages)
```

目标顺序口径：

```text
system -> history -> incremental
```

---

## 2) 职责边界

### Agent 侧
1. 构建并透传 `messageBlocks`（`system/history/incremental`）。
2. 提供统一入口：`resolveMessageBlock({ scope, messages, ctx })`。
3. 保证“无插件时”仍走原链路，不被影响。

### 插件侧
1. 在 `before_llm_call` 读取 `ctx.messageBlocks`。
2. 按插件逻辑调用 `resolveMessageBlock(scope)` 后重组 `ctx.messages`。
3. 允许前置/后置注入，但不绕过统一过滤裁剪入口。

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

共同语义：
- 过滤 `summarized: true`；
- 过滤非法 tool-call/tool-result pair；
- 按 `dialogProcessId` 过滤不属于当前链路的 injected 消息。

---

## 5) 关键调用点（便于排查）

1. Agent 构建分块：`buildContextMessageBlocks(...)`
2. Hook 透传：`buildHookContext(...).messageBlocks`
3. Agent 注入统一入口：`_createHarnessResolveMessageBlock(...)`
4. 插件重组：`capabilities/runtime.js -> applyMessageBlocksForBeforeLlmCall(...)`

---

## 6) 常见误区（精简版）

1. **“插件模式会改掉无插件行为”**：不会，无插件仍走原链路。  
2. **“system 也会被 recent 裁剪”**：不会。  
3. **“current user 永远是最终最后一条”**：不保证，插件可后置注入。  
4. **“只看最后一次日志就能还原全部裁剪过程”**：不行，历史通常是两段处理后才进入最终请求。
