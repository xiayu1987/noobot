# 模型供应商适配与 Prompt Cache

本文说明 Noobot 当前模型运行时的供应商识别、默认参数和缓存策略。模型字段契约以 `@noobot/model-protocol` 为唯一事实源；请求适配以 `@noobot/model-runtime` 为唯一实现。

## 代码边界

- `model-protocol/src/model/provider-spec.js`：provider 配置字段、推理传输参数表和 operator 契约。
- `model-protocol/src/model/model-adapter.js`：模型系列到 wire adapter 的不可配置事实映射。
- `model-runtime/src/normalization/spec-normalizer.js`：运行时默认参数与模型系列分类。
- `model-runtime/src/policies/cache-policy-engine.js`：供应商缓存参数与采样参数编译。
- `model-runtime/src/adapters/openai-compatible-adapter.js`：OpenAI-compatible 客户端和 Responses API 选择。
- `model-runtime/src/adapters/anthropic-messages-adapter.js`：Anthropic 原生 Messages API 客户端。
- `agent/src/models/tool/binding-adapter.js`：工具名称、排序和 strict schema 策略。
- `model-proxy/src/cache-diagnostics.js`：代理侧缓存诊断。

Agent、插件和代理不得复制上述规则或自行识别供应商。

## 统一传输格式与供应商识别

传输 adapter 不是配置字段。`format` 和 `adapter_id` 已从配置协议移除；规范化阶段根据模型系列事实源生成内部 `adapterId`，并拒绝/忽略配置中的传输覆盖。当前事实映射为 Claude → `anthropic-messages`，其他已知系列 → `openai-compatible`。供应商由解析后的 `base_url` 主机确定：

| API 主机                              | `operatorId` |
| ------------------------------------- | ------------ |
| `api.openai.com`                      | `openai`     |
| `api.anthropic.com`                   | `anthropic`  |
| `generativelanguage.googleapis.com`   | `google`     |
| `dashscope.aliyuncs.com`              | `alibaba`    |
| `open.bigmodel.cn`                    | `zhipu`      |
| `api.deepseek.com`                    | `deepseek`   |
| `api.x.ai`                            | `xai`        |
| `api.moonshot.cn` / `api.moonshot.ai` | `kimi`       |
| 其他主机或尚未解析的地址占位符        | `generic`    |

模型系列只根据实际 `model` 名称分类；配置 alias 不参与模型系列识别。环境变量名也不用于推断供应商。系列能力和传输 adapter 由协议事实源与运行时适配层统一维护。端点是否接受可选请求字段不能由模型系列证明，必须由 provider 配置显式声明。

推理传输参数不由模型名推导，而是每个 provider 用 `reasoning_effort_parameter` 显式声明，取值限于 `reasoning_effort`、`thinking_level`、`enable_thinking`。参数名到线上值形态的映射维护在 `model-protocol/src/model/provider-spec.js`：前两者携带强度枚举，`enable_thinking` 是布尔开关，`reasoning_effort=none` 转为 `false`，其他档位转为 `true`。

`reasoning_effort_options` 是该 provider 支持的档位全集，最低档在前。超出该集合的配置值不是受支持的事实，会回落到最低档；需要抑制思考时使用最低档，而不是硬编码某个字面量。

## 运行时默认参数

配置文件可以省略采样参数。运行时按“传输 → operator → 模型系列 → 具体模型”应用默认值，用户显式配置始终优先。模型系列分类同时用于采样默认值和查找不可配置的传输 adapter。默认参数维护在 `model-runtime/src/normalization/spec-normalizer.js`，不要复制到模型库条目中。

当 OpenAI-compatible 配置显式给出 `top_p` 而未给出 `temperature` 时，运行时不会再补 `temperature`，避免同时发送两种采样控制。

## 缓存策略

`model-runtime/src/policies/cache-policy-engine.js` 会先从 `extra_body` 移除所有跨供应商缓存字段，再从 provider 协议的唯一字段编译请求。`extra_body` 不是缓存配置入口；这样不会出现显式配置与透传字段相互覆盖的第二事实源。

### 统一缓存策略

用户只配置 `prompt_cache_fields`，从当前模型系列公布的候选列表中选择目标端点支持的请求字段。字段值由系统生成，用户不能直接填写传输值：

| 选择项                   | 系统生成值                                  |
| ------------------------ | ------------------------------------------- |
| `prompt_cache_key`       | `noobot-<flow>-<model>`                     |
| `prompt_cache_options`   | OpenAI-compatible：`{ "ttl": "30m" }`       |
| `prompt_cache_options`   | Kimi：`{ "mode": "implicit", "ttl": "5m" }` |
| `prompt_cache_retention` | `"24h"`                                     |
| `cache_control`          | `{ "type": "ephemeral" }`                   |

运行时不会根据 `operatorId`、模型名、base URL、API key 或反代错误自动启用字段，也不会在 400 后删除字段重试。未选择时完全省略。`extra_body` 中的同名字段会被移除，避免形成第二配置入口；官方端点与兼容端点遵守同一规则。

协议和模型库承担不同职责：

- `MODEL_FAMILY_PROMPT_CACHE_FIELDS` 是模型系列的**可配置候选上限**。它由当前 wire adapter 能表达的协议决定，并包含 OpenAI-compatible 供应商可能实现的新旧缓存字段；它不等于官方端点默认支持声明。
- `model-library.json` 是具体模型的**官方默认选择事实**。只有官网确认且当前 adapter 能正确表达的字段才会默认勾选。
- provider 的 `prompt_cache_fields` 是用户对实际目标端点的**显式选择**。运行时只发送这里选中的字段，并校验它没有越过模型系列候选上限。

当前模型系列候选上限如下：

| 模型系列                          | 可选字段                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| GPT                               | `prompt_cache_key`、`prompt_cache_options`、`prompt_cache_retention`                  |
| Claude                            | `cache_control`                                                                       |
| Qwen                              | `prompt_cache_key`、`prompt_cache_options`、`prompt_cache_retention`、`cache_control` |
| Grok、Gemini、GLM、DeepSeek、Kimi | `prompt_cache_key`、`prompt_cache_options`、`prompt_cache_retention`                  |
| Generic                           | 上述四项                                                                              |

Claude 使用原生 Anthropic Messages adapter，因此不能选择 OpenAI body 字段。其他系列当前使用 OpenAI-compatible adapter，所以保留新旧 OpenAI 缓存字段供兼容供应商显式选择；这不会把这些字段自动发送到该模型的官方端点。Qwen 额外支持官方消息内容块 `cache_control`，Generic 则保留全部可表达字段。

模型库的每个 provider 都显式保存具体模型的 `prompt_cache_fields` 默认事实：GPT-5.6+ 默认 key/options，GPT-5.4/5.5 默认 key/retention，Claude 默认 cache_control，Grok 默认 key，Qwen 默认 cache_control，Kimi K3 默认 key/options，Gemini、DeepSeek、GLM 和图像模型默认空。代码不再用版本判断或具体型号正则重复推导默认值，只校验模型库默认值没有越过所属系列上限。全局配置模板、默认用户配置模板和实际用户配置是模型库默认值的持久化投影；配置修复会从模型库补齐缺失字段，但不会覆盖用户已经保存的合法选择。未知兼容模型默认不发送任何缓存字段，必须由用户显式选择。

前端候选项始终来自模型系列协议，不由模型库默认值裁剪。因此 GPT-5.6 默认勾选 key/options，但仍显示旧的 retention 供只实现旧协议的兼容供应商使用；Kimi 默认 key/options，也仍显示 retention。模型库只决定初始默认勾选，不充当用户选择白名单。

### OpenAI-compatible Prompt Cache

- 选择 `prompt_cache_key` 后，系统按调用 flow 和实际模型生成稳定键；用户不维护键内容。
- GPT-5.6 及以上使用 `prompt_cache_options`，系统发送 `{ "ttl": "30m" }`。当前不开放 `mode: "explicit"`，因为 Noobot 尚未定义并生成配套的 `prompt_cache_breakpoint` 协议。
- 官方列明支持扩展保留期的 GPT-5.6 以下模型使用 `prompt_cache_retention`，系统发送 `"24h"`；其他早期模型只提供缓存键。仅当目标模型和组织的数据保留策略支持时选择保留期字段。
- `prompt_cache_options` 与 `prompt_cache_retention` 属于不同模型代际；配置者必须依据目标端点协议选择其中一个，运行时不会猜测版本。
- GPT-5 不发送 `top_p`。

官方依据：[OpenAI Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)。该文档说明 GPT-5.6 及以上使用 `prompt_cache_options.ttl`，唯一支持值和默认值均为 `30m`；较早模型使用 `prompt_cache_retention`；`prompt_cache_key` 在 GPT-5.6 及以上可用于独立缓存计量，在较早模型上用于稳定缓存路由。

### Anthropic

选择 `cache_control` 后，Claude 原生 Messages adapter 在请求顶层写入 `{ "type": "ephemeral" }`，使用 Anthropic 官方自动缓存断点和默认 5 分钟 TTL。未选择时不发送。Claude 不改写 OpenAI `messages` 内容块；网关必须将该顶层字段转换为 Anthropic Messages API 的顶层字段，或直接转发到原生 `/v1/messages`。
官方依据：[Anthropic Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)。

### Google / Gemini

Gemini 2.5 及以上的隐式缓存自动开启，不需要请求字段。显式缓存属于独立资源生命周期：先通过缓存服务创建 `CachedContent`，再在 Generate Content 请求中引用 `cached_content`；因此它不属于可自动生成的 `prompt_cache_fields` 默认值，模型库默认保持空。Gemini 的 OpenAI-compatible 兼容端点若明确支持 OpenAI 新旧缓存字段，用户可从系列候选中显式选择。
官方依据：[Gemini Context caching](https://ai.google.dev/gemini-api/docs/caching) 与 [Generate Content explicit caching](https://ai.google.dev/gemini-api/docs/generate-content/caching)。

### Grok

选择 `prompt_cache_key` 时，Grok Chat Completions 由适配层映射为官方建议的 `x-grok-conv-id` 请求头，Responses API 则发送 `prompt_cache_key`；两者是不同传输协议下的同一用户选择。若兼容端点明确实现 OpenAI 的 options/retention，用户也可显式选择；官方 xAI 默认只选择 key。
官方依据：[xAI Prompt Caching](https://docs.x.ai/developers/advanced-api-usage/prompt-caching)。

### Qwen

Qwen 系列在选择 `cache_control` 后使用与 DashScope 官方兼容的消息级标记，标记首个稳定 system 文本块；不会把 `cache_control` 作为顶层字段发送。其隐式前缀缓存由服务端自动管理。模型库给百炼官方模型默认选择 cache_control；若 Qwen 兼容端点只实现 OpenAI 新旧缓存字段，用户可改选 key/options/retention，运行时按 OpenAI-compatible body 发送。
官方依据：[Alibaba Cloud Model Studio Context cache](https://www.alibabacloud.com/help/en/model-studio/context-cache)。

### Kimi

Kimi 官方当前支持 `prompt_cache_key` 和 `prompt_cache_options`。Kimi 的 options 不是 OpenAI 的 30 分钟结构，而是 `{ "mode": "implicit", "ttl": "5m" }`；TTL 只支持 `5m | 1h`，省略 options 时官方也会默认启用 5 分钟缓存写入。模型库中的 Kimi K3 默认选择 key/options，系统生成官方结构；兼容供应商若只支持旧 retention，用户仍可改选 retention。

官方依据：[Kimi Chat API](https://platform.kimi.com/docs/api/chat)。

### DeepSeek、GLM 与通用兼容端点

DeepSeek 官方会为每次请求自动建立磁盘缓存，并在 usage 中返回缓存命中统计，没有客户端缓存控制字段；GLM 官方上下文缓存也会自动识别并复用重复内容。因此它们在模型库中的官方默认值保持空。官方依据：[DeepSeek Context Caching](https://api-docs.deepseek.com/guides/kv_cache) 与 [Z.ai Context Caching](https://docs.z.ai/guides/capabilities/cache)。

若某个 DeepSeek、GLM、Gemini 或其他 OpenAI-compatible 端点明确支持 OpenAI 的新字段或旧字段，用户直接在对应模型系列候选中选择，不需要伪装成 Generic，也不需要修改模型名。该选择是 provider 配置中的明确事实；运行时不会根据 URL、API key、错误响应或供应商名称推导，也不会删参重试。

## Responses API

`use_responses_api` 是显式 provider 配置。只有模型名包含 `codex` 时运行时默认开启；其他模型不会因为版本、alias 或供应商名称自动切换传输方式。

Noobot 不保存或复用 `previous_response_id`。Session、编辑重发、分支、子 Session 和多 Agent 上下文仍由 Noobot 自己的协议管理，不能在继续发送完整消息的同时推导 provider thread。

## 工具绑定

`agent/src/models/tool/binding-adapter.js` 负责：

- 校验并去重工具名称；
- 按工具名称稳定排序；
- 根据模型与工具能力决定 strict schema；
- 对不支持的 Claude tool-search 形态执行明确过滤。

业务调用方不得再次排序、降级或按 alias 推断工具能力。

## 配置原则

模型条目只声明身份、凭据地址、能力和用户确实需要覆盖的参数：

`adapter_id` 不属于配置字段；Anthropic/Claude 的原生 Messages adapter 由模型系列事实自动绑定。

```json
{
  "enabled": true,
  "api_key": "${OPENAI_API_KEY}",
  "base_url": "${OPENAI_API_ADDRESS}",
  "model": "gpt-5.6-sol",
  "reasoning_effort": "medium",
  "tool_reasoning_effort": "medium",
  "reasoning_effort_options": ["none", "low", "medium", "high", "xhigh", "max"],
  "reasoning_effort_parameter": "reasoning_effort"
}
```

通常不需要配置 `temperature`、`top_p`、`max_tokens` 或缓存字段。只有目标端点协议明确支持时，才选择对应缓存字段。OpenAI GPT-5.6 及以上可配置为：

```json
{
  "prompt_cache_fields": ["prompt_cache_key", "prompt_cache_options"]
}
```

较早的 OpenAI 模型选择 `prompt_cache_key` 和 `prompt_cache_retention`；Anthropic 选择 `cache_control`。前端配置页从同一协议列表生成多选控件，不能输入任意字段或覆盖系统值。

## 验证与排查

```bash
npm test -w @noobot/model-protocol
npm test -w @noobot/model-runtime
```

缓存未命中时依次核对实际请求字段、system 前缀、工具名称和 schema 顺序，以及供应商返回的 cached-token 统计。不得根据 alias、模型名、环境变量名或相似 URL 推断供应商能力。端点返回 `Unsupported parameter` 时应修正该 provider 的能力声明，不得静默删参重试。
