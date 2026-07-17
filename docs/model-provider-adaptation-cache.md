# 模型厂商缓存适配与 Prompt Cache 策略

本文记录 Noobot 在模型工厂层对不同模型厂商和模型系列的缓存适配规则。后续新增模型、切换 provider、排查缓存命中率时，以本文作为工程约定。

相关代码：

- `agent/src/system-core/model/factory/chat-model.js`
- `agent/src/system-core/model/spec/defaults.js`
- `agent/src/system-core/model/tool/binding-adapter.js`
- `model-proxy/src/cache-diagnostics.js`

## 1. 目标

缓存适配主要解决三类问题：

1. 不同厂商公布的缓存机制不同，不能把 OpenAI 的字段直接套到 Claude、Gemini、DeepSeek 或 Qwen 上。
2. Prompt Cache 对请求稳定性敏感，需要稳定 system/developer prompt、tools 顺序、模型参数和 cache key。
3. Noobot 现有消息链路包含多轮工具调用、子会话和插件注入，transport 或 provider thread 复用必须谨慎启用。

## 2. 当前内置适配

### 2.1 OpenAI / OpenAI-compatible GPT 系列

识别规则：

```text
format = "openai_compatible"
且 model/base_url/provider/alias 指向 OpenAI GPT/o/Codex/ChatGPT 系列
```

当前内置行为：

- 自动生成稳定 `promptCacheKey` / `prompt_cache_key`。
- 对支持扩展缓存控制的 OpenAI GPT 系列自动设置 `promptCacheRetention` / `prompt_cache_retention` 为 `24h`。
- 显式 `prompt_cache_key`、`promptCacheKey`、`prompt_cache_retention`、`promptCacheRetention` 优先。
- 普通 GPT-5/GPT-6 不默认强制 `useResponsesApi: true`，避免改变现有消息构建和工具调用链路。
- GPT-5 系列移除 `top_p`，避免请求失败。

默认 cache key 规则：

```text
gpt-4o  -> noobot-main-gpt-4o
gpt-4.1 -> noobot-main-gpt-4-1
gpt-5.5 -> noobot-main-gpt-5-5
gpt-6.1 -> noobot-main-gpt-6-1
```

默认 retention 规则：

```text
gpt-4.1 -> 24h
gpt-5.x -> 24h
gpt-6.x -> 24h
```

`gpt-4o` 会自动获得稳定 key，但当前不自动设置 `24h` retention。

### 2.2 Codex-like 系列

识别规则：

```text
model 或 alias 包含 codex
```

当前内置行为：

- `resolveUseResponsesApi()` 默认允许 Codex-like 模型走 Responses API。
- tool binding 默认启用 strict schema，除非遇到已知不兼容工具。
- 仍使用 OpenAI 的 Prompt Cache 参数构建逻辑。

Codex-like 模型和普通 GPT-5+ 的区别是，Codex-like 更接近官方 Codex transport 偏好，因此允许默认 Responses；普通 GPT-5/GPT-6 不默认强切 Responses。

### 2.3 Anthropic / Claude

厂商策略：

- Anthropic 的 prompt caching 是 message content block 级别的 `cache_control`。
- 常见做法是在 system prompt、长工具定义、长文档或稳定上下文后设置 cache breakpoint。

Noobot 当前内置行为：

- 识别 `anthropic`、`claude`、Anthropic base URL。
- 不发送 OpenAI 的 `prompt_cache_key` / `prompt_cache_retention`。
- 保持 prompt 前缀和 tools 顺序稳定，给后续 Claude 专用适配留出空间。

暂不自动实现的原因：

- `cache_control` 不是顶层请求参数，需要改消息 content block。
- Noobot 当前 Claude 兼容路径多走 `ChatOpenAI` / OpenAI-compatible 消息形态，直接改 block 可能影响工具调用和历史消息。

后续如引入真实 Anthropic adapter，可在消息构建层增加显式开关，例如：

```json
{
  "anthropic_prompt_cache": {
    "enabled": true,
    "system": true,
    "tools": true
  }
}
```

### 2.4 Gemini

厂商策略：

- Gemini 有 implicit caching，也有 explicit context caching API。
- 命中依赖稳定前缀、足够长的上下文和相同模型等条件。

Noobot 当前内置行为：

- 识别 `gemini`、Google Generative Language base URL。
- 不发送 OpenAI 的 `prompt_cache_key` / `prompt_cache_retention`。
- 继续保持 system prompt、tools 顺序和参数稳定。

暂不自动实现 explicit context cache 的原因：

- explicit cache 需要创建和引用 provider 侧 cached content 资源。
- 这和 Noobot 自己的 session tree、编辑回滚、子会话、多 Agent 状态有关，不能只靠一个顶层字段安全完成。

### 2.5 DeepSeek

厂商策略：

- DeepSeek 公布的上下文缓存以服务端自动缓存为主，通常不需要客户端传显式 cache key。
- 命中重点是输入前缀稳定。

Noobot 当前内置行为：

- 识别 `deepseek` model/provider/base URL。
- 不发送 OpenAI 的 `prompt_cache_key` / `prompt_cache_retention`。
- 保持 tools 顺序稳定，减少请求体抖动。

### 2.6 DashScope / Qwen

厂商策略：

- DashScope / Qwen 有自己的上下文缓存能力。
- 在 DashScope OpenAI 兼容 Responses API 场景，可通过 `x-dashscope-session-cache: enable` 使用多轮对话缓存。
- 非 Responses 或非专用接口下，不能简单套用 OpenAI 的 `prompt_cache_key`。

Noobot 当前内置行为：

- 识别 `format = "dashscope"`、`dashscope`、`aliyuncs`、`qwen`、`qianwen`。
- 不发送 OpenAI 的 `prompt_cache_key` / `prompt_cache_retention`。
- `enable_thinking` 未配置时默认 `false`。
- `thinking_budget` 支持显式 `0`。
- 显式配置 `use_responses_api: true` 时，请求头自动加入：

```text
x-dashscope-session-cache: enable
```

默认不强制 DashScope Responses API，避免改变现有 Chat Completions 消息链路。

## 3. 防串厂商规则

以下字段只允许发送给 OpenAI cache vendor：

```text
prompt_cache_key
prompt_cache_retention
promptCacheKey
promptCacheRetention
```

如果这些字段被误放进 Claude、Gemini、DeepSeek、DashScope/Qwen 的配置或 `extra_body`，模型工厂会剥离它们。

这样做的目的：

- 避免 OpenAI-only 字段导致第三方 provider 报错。
- 避免看似启用缓存，实际 provider 完全忽略，排查时产生误判。
- 保留将来做 provider 专用适配的清晰边界。

## 4. 已内置的通用命中优化

1. 稳定 cache key：
   - OpenAI GPT/o/Codex 系列自动生成 `noobot-main-<model>`。
   - 显式配置优先。

2. 稳定 cache retention：
   - OpenAI `gpt-4.1`、`gpt-5.x`、未来 `gpt-6.x` 默认 `24h`。
   - 显式配置优先。

3. LangChain 原生字段映射：
   - `promptCacheKey`
   - `promptCacheRetention`

4. OpenAI snake_case 透传：
   - `prompt_cache_key`
   - `prompt_cache_retention`

5. tools 稳定排序：
   - `adaptToolsForBinding()` 会按 tool name 排序，降低 tool schema 顺序抖动。

6. DashScope Responses session cache：
   - 仅在 `format = "dashscope"` 且显式 `use_responses_api: true` 时启用请求头。

## 5. 为什么不默认强制 Responses API

Noobot 主流程消息由标准 LangChain 消息组成：

- `SystemMessage`
- `HumanMessage`
- `AIMessage`
- `ToolMessage`

LangChain 能把这些转换为 Responses API input，但强制切换 transport 会改变底层请求结构。Noobot 现有链路还包含：

- assistant tool call 历史；
- tool result；
- 多轮工具循环；
- retry / fallback；
- session tree / sub-session；
- harness 插件注入。

因此当前策略是：

- 厂商安全的缓存参数自动内置；
- transport 不默认改变；
- 需要实验时由 provider 显式配置 `use_responses_api: true`。

## 6. 线程 / previous_response_id

当前没有默认启用 OpenAI Responses thread 续接，也没有保存 `previous_response_id`。

原因：

- Noobot 已有自己的 `sessionId / parentSessionId / dialogProcessId` 会话树。
- provider thread 复用需要处理编辑、删除、回滚、分支、子会话、多 Agent 等复杂状态。
- 如果继续全量发送 messages，同时又传 `previous_response_id`，可能出现上下文重复或状态不一致。

后续如果要实验 provider thread reuse，建议新增显式开关，例如：

```json
{
  "responses_thread_reuse": true
}
```

并仅在普通连续主会话中启用，不应默认影响子会话、分支会话和编辑后的会话。

## 7. 新增模型系列时的适配流程

新增模型系列时按以下顺序评估：

1. 确认 provider format：
   - `openai_compatible`
   - `dashscope`
   - 新 format

2. 确认厂商公布的缓存策略：
   - 顶层请求参数；
   - 消息 content block 标注；
   - 显式 cached content 资源；
   - 服务端自动缓存；
   - 专用 header。

3. 在 `agent/src/system-core/model/spec/defaults.js` 增加 profile 规则：
   - 默认 temperature；
   - top_p；
   - penalty；
   - thinking budget。

4. 在 `agent/src/system-core/model/factory/chat-model.js` 增加请求参数规则：
   - 是否支持 `top_p`；
   - 是否支持 `reasoning_effort`；
   - 是否支持 Prompt Cache；
   - 是否需要 Responses API；
   - 是否需要 provider 专用 header。

5. 在 `agent/src/system-core/model/tool/binding-adapter.js` 增加工具绑定规则：
   - 是否默认 strict；
   - 是否有 strict 不兼容工具；
   - tools 顺序必须稳定。

6. 增加测试：
   - 参数是否被正确保留/删除；
   - cache key 是否稳定；
   - retention 是否符合预期；
   - 显式配置是否优先；
   - OpenAI-only 字段是否不会串到其他厂商；
   - 不应改变 transport 的模型是否保持现状。

## 8. 推荐配置原则

普通 OpenAI GPT 会话模型配置保持简洁：

```json
{
  "model": "gpt-5.5",
  "format": "openai_compatible",
  "reasoning_effort": "low",
  "temperature": 0.7,
  "max_tokens": 10000
}
```

不需要手写：

```json
{
  "prompt_cache_key": "...",
  "prompt_cache_retention": "24h"
}
```

这些由模型工厂自动补齐。

如果不同用途不应共享 cache key，可以显式指定：

```json
{
  "prompt_cache_key": "noobot-main-gpt-5-5-programming"
}
```

常见隔离维度：

- 主会话 / 插件子流程；
- 编程 / 普通文本；
- 高风险工具集 / 低风险工具集；
- 多租户环境中的安全隔离。

需要实验 Responses API 时，只对目标 provider 显式开启：

```json
{
  "use_responses_api": true
}
```

## 9. 排查缓存命中

优先检查：

1. `model-proxy` 日志里的 `prompt_cache_key` 是否稳定。
2. system/developer prompt 前缀是否稳定。
3. tools 数量、名称、schema 顺序是否稳定。
4. 第三方 orchestrator 是否每轮改写 system prompt 或 tool schema。
5. provider 是否支持当前传入的缓存字段。
6. 是否切换了 model、base_url、transport 或 provider thread。

如果 `cached_input_tokens` 仍接近 0，先不要直接归因于模型 bug。应先确认请求体前缀、tools 顺序、cache key、transport 和厂商缓存策略是否一致。
