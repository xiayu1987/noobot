# Agent 原生模式：模型消息流（无插件参与）

本文档描述 **不启用插件** 时，Agent 主链路的模型消息构建规则。

## 1) 主链路

```text
base = buildContextMessages(...)
run before_llm_call hooks (if any)
final = filterForModelContext(base)
invoke(final)
```

对应实现位置：
- 基础消息构建：`agent/core/context/message-builder.js`
- LLM 调用前过滤：`agent/core/turn/turn-executor.js`（`invoke(...filterForModelContext(messages))`）

默认基础顺序：

```text
system -> effectiveHistoryMessages -> currentUserMessage -> currentUserMeta
```

> `currentUserMessage/currentUserMeta` 只保证在基础数组尾部；hook 追加后不一定是最终尾部。

---

## 2) 历史消息两段处理

### 第一段（会话级）
- 输出：`agentContext.payload.messages.history`
- 典型处理：dialog 过滤、injected 同类型最新保留、`summarized:true` 过滤、tool pair 合法化、窗口截断（recent fallback 默认 20）

### 第二段（主模型前）
- 输出：`effectiveHistoryMessages`
- 入口：`resolveModelContextMessages(...)`
- 典型处理：再次 dialog / injected 同类型最新保留 / summarized / tool pair 过滤
- recent 配置：`context.mainModelRecentWindow`（默认开）+ `context.mainModelRecentLimit`（默认 15）

---

## 3) 关键边界

1. `system messages` 不参与 history recent window。
2. 当前用户消息在历史处理后追加，不参与 history recent 计数。
3. 最终请求前统一执行 `filterForModelContext(messages)`。
4. hook 允许改写顺序（prepend/append/replace/splice）。
5. 若 hook 或 harness 向主链路注入消息，筛选会按 `injectedBy + injectedMessageType` 分组只保留同类型最新一条；缺少 `injectedMessageType` 的旧消息会按内部类型 / relay purpose / `type` / `injectedBy` 回退。
6. Agent 小结工具标记当前轮消息时，同样按 `injectedBy + injectedMessageType` 保护同类型最新 injected 消息不标 `summarized:true`，旧的同类型 injected 消息会被标记。

---

## 4) 快速判读日志

- `system` 段：系统上下文，通常在最前；
- `history` 段：已是两段过滤后的结果；
- `currentUser + meta`：当前轮追加；
- 若末尾还有消息：通常来自 `before_llm_call` 后置注入。
