# 模型供应商适配与 Prompt Cache

本文说明 Noobot 当前模型运行时的供应商识别、默认参数和缓存策略。模型字段契约以 `@noobot/model-protocol` 为唯一事实源；请求适配以 `@noobot/model-runtime` 为唯一实现。

## 代码边界

- `model-protocol/src/model/provider-spec.js`：provider 配置字段、format、operator 和 adapter 契约。
- `model-runtime/src/normalization/spec-normalizer.js`：运行时默认参数与模型系列分类。
- `model-runtime/src/policies/cache-policy-engine.js`：供应商缓存参数与采样参数编译。
- `model-runtime/src/adapters/openai-compatible-adapter.js`：OpenAI-compatible 客户端和 Responses API 选择。
- `agent/src/models/tool/binding-adapter.js`：工具名称、排序和 strict schema 策略。
- `model-proxy/src/cache-diagnostics.js`：代理侧缓存诊断。

Agent、插件和代理不得复制上述规则或自行识别供应商。

## 统一传输格式与供应商识别

当前唯一模型传输格式是 `openai_compatible`。`format` 只选择 adapter，供应商由解析后的 `base_url` 主机确定：

| API 主机                            | `operatorId` |
| ----------------------------------- | ------------ |
| `api.openai.com`                    | `openai`     |
| `api.anthropic.com`                 | `anthropic`  |
| `generativelanguage.googleapis.com` | `google`     |
| `dashscope.aliyuncs.com`            | `alibaba`    |
| `open.bigmodel.cn`                  | `zhipu`      |
| `api.deepseek.com`                  | `deepseek`   |
| 其他主机或尚未解析的地址占位符      | `generic`    |

模型系列只根据实际 `model` 名称分类；配置 alias 不参与模型系列识别。环境变量名也不用于推断供应商。

## 运行时默认参数

配置文件可以省略采样参数。运行时按“format → operator → 模型系列 → 具体模型”应用默认值，用户显式配置始终优先。默认参数维护在 `model-runtime/src/normalization/spec-normalizer.js`，不要复制到模型库条目中。

当 OpenAI-compatible 配置显式给出 `top_p` 而未给出 `temperature` 时，运行时不会再补 `temperature`，避免同时发送两种采样控制。

## 缓存策略

`model-runtime/src/policies/cache-policy-engine.js` 会先从 `extra_body` 移除所有跨供应商缓存字段，再按已识别的 `operatorId` 和模型系列生成目标请求参数。

### OpenAI GPT

仅当 `format=openai_compatible` 且模型系列为 GPT 时：

- 生成稳定的 `prompt_cache_key`，格式为 `noobot-<flow>-<model>`；主流程简化为 `noobot-main-<model>`。
- GPT 5.6 及以上默认使用 `prompt_cache_options: { "ttl": "30m" }`。
- GPT 4.1 和其他 GPT 5 系列默认使用 `prompt_cache_retention: "24h"`。
- GPT-5 不发送 `top_p`。
- 显式配置的缓存字段优先于运行时默认值。

### Anthropic

`operatorId=anthropic` 时使用 `cache_control`，默认 `{ "type": "ephemeral" }`。可显式关闭或配置支持的 TTL。OpenAI 和 Gemini 缓存字段不会透传。

### Google / Gemini

`operatorId=google|gemini` 时，仅在显式配置 `cached_content` 或 `gemini_cached_content` 后发送 `cached_content`。其他供应商缓存字段不会透传。

### Alibaba、Zhipu、DeepSeek 与通用网关

当前不自动添加供应商专用缓存字段。Noobot 仍通过稳定的 system 前缀和按名称排序的工具 schema 提高服务端自动缓存命中率。

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

```json
{
  "enabled": true,
  "api_key": "${OPENAI_API_KEY}",
  "base_url": "${OPENAI_API_ADDRESS}",
  "model": "gpt-5.6-sol",
  "format": "openai_compatible"
}
```

通常不需要配置 `temperature`、`top_p`、`max_tokens` 或缓存字段；运行时默认值负责这些参数。需要实验 Responses API 或覆盖缓存策略时，只在目标 provider 上显式配置对应字段。

## 验证与排查

```bash
npm test -w @noobot/model-protocol
npm test -w @noobot/model-runtime
```

缓存未命中时依次核对实际模型、`operatorId`、请求 flow、system 前缀、工具名称和 schema 顺序，以及供应商返回的 cached-token 统计。不得根据 alias、环境变量名或相似 URL 推断供应商能力。
