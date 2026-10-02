# 模型目录更新：2026-09-28

> 2026-10-02 起，`user-template/default-user/config.example.json` 和 `config.json` 已下线。用户配置改由 `@noobot/agent-config-protocol` 按协议结构、全局 `baseValues` 和模型库生成。下文保留当时的原始记录。

模型声明的唯一来源是 `model-protocol/model-library.json`。本次将新增声明复制到全局配置示例、默认用户配置示例及本机实际配置，没有增加运行时型号兼容分支。保留现有默认模型选择、用户自定义连接参数和其他配置。

## 新增型号与官方依据

| 配置别名                 | API 型号                                | 官方依据                                                                                 |
| ------------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `gpt_6_sol`              | `gpt-6-sol`                             | [OpenAI](https://developers.openai.com/api/docs/models/gpt-6-sol)                        |
| `gpt_6_luna`             | `gpt-6-luna`                            | [OpenAI](https://developers.openai.com/api/docs/models/gpt-6-luna)                       |
| `claude_opus_5_5`        | `claude-opus-5-5`                       | [Anthropic](https://platform.claude.com/docs/en/models/opus-5-5/overview)                |
| `gemini_3_8_flash`       | `gemini-3.8-flash`                      | [Google](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)                  |
| `deepseek_flash`         | `deepseek-flash`（当前指向 V4.1 Flash） | [DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/)                           |
| `grok_4_7`               | `grok-4.7`                              | [xAI](https://docs.x.ai/developers/grok-4-7)                                             |
| `qwen3_8_max`            | `qwen3.8-max`                           | [Alibaba Cloud](https://www.alibabacloud.com/help/en/model-studio/text-generation-model) |
| `qwen3_8_flash`          | `qwen3.8-flash`                         | [Alibaba Cloud](https://www.alibabacloud.com/help/en/model-studio/text-generation-model) |
| `glm_5_3_flash`          | `glm-5.3-flash`                         | [Z.AI](https://docs.z.ai/guides/vlm/glm-5.3-flash)                                       |
| `glm_5_3_flashx`         | `glm-5.3-flashx`                        | [Z.AI](https://docs.z.ai/guides/vlm/glm-5.3-flash)                                       |
| `gpt_image_2_5_sunburst` | `gpt-image-2.5-sunburst`                | [OpenAI](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)           |

GPT-6 Sol/Luna 配置 `use_responses_api: true`。官方规定 Chat Completions 仅在 `reasoning_effort: none` 时支持这两个型号的函数调用；带推理工具调用使用 Responses。缓存使用 `prompt_cache_key` / `prompt_cache_options`，不沿用 GPT-5.5 的 `prompt_cache_retention`。依据：[模型迁移说明](https://developers.openai.com/api/docs/guides/latest-model#gpt-6-astra-update-api-and-model-parameters)。

Claude Opus 5.5 的思考档位为 low/medium/high/xhigh/max，默认 medium，不提供关闭思考选项。依据：[effort](https://platform.claude.com/docs/en/build-with-claude/effort)。Gemini 3.8 Flash 不支持 minimal；Grok 4.7 的档位为 low/medium/high/xhigh；GLM-5.3 Flash/FlashX 的档位为 low/high/max，且不能关闭思考。

Qwen 3.8 Max/Flash 使用 `enable_thinking`，支持图片、视频及显式缓存。依据：[思考模式](https://www.alibabacloud.com/help/en/model-studio/deep-thinking)、[视觉模型](https://www.alibabacloud.com/help/en/model-studio/vision-model)、[上下文缓存](https://www.alibabacloud.com/help/en/model-studio/context-cache)。DeepSeek Flash 的视觉能力依据：[Vision](https://api-docs.deepseek.com/guides/vision)。

Sunburst 沿用项目中 Flare 已配置的 `images_async` 图片网关协议，不参与普通聊天。此协议包含创建任务及查询任务，**不是 OpenAI 官方同步 Images API**；使用该条目需要所配置的图片网关提供对应模型和任务接口。官方型号发布不代表用户的第三方网关已经提供它。本次未修改既有图片网关协议，也未进行收费的模型调用。

## 清理规则和结果

“落后三代”按同一产品线已发布的连续版本计算，不跨厂商、不跨产品档位比较版本数字；同代不同规格不重复计代。只有官方确认已退役，或可以明确列出至少三次后续代际升级，才清理。

- 删除 `gpt_5_4` / `gpt-5.4`：`5.4 → 5.5 → 5.6 → 6`，落后三代。这是本项目的保留策略，**并不表示 OpenAI 已下架 GPT-5.4**。型号列表依据：[OpenAI Models](https://developers.openai.com/api/docs/models)。原配置如引用该别名，迁移到 `gpt_6_sol`。
- 删除 `deepseek_v4_flash` / `deepseek-v4-flash`：官方明确原模型已退役，旧名称仅转发到 V4.1 Flash。只保留当前标准名称 `deepseek-flash`，原引用迁移到 `deepseek_flash`。
- 保留 GPT-5.5、Claude Opus 5/4.8、Claude Fable 5/5.1、Sonnet 5、Haiku 4.5、Gemini 3.1 Pro Preview、Qwen 3.6 Flash、GLM-5.1/5.2 等现有条目：它们没有满足本次删除条件。Opus 4.8 和 GLM-5.1 是已有用户自定义配置，不额外加入模型库。
- Kimi K3 已是现有条目，官方仍列为旗舰：[Kimi 模型说明](https://platform.kimi.ai/docs/overview)，无需重建重复项。

下架状态交叉核对：[OpenAI](https://developers.openai.com/api/docs/deprecations)、[Anthropic](https://platform.claude.com/docs/en/about-claude/model-deprecations)、[Google](https://ai.google.dev/gemini-api/docs/deprecations)、[xAI](https://docs.x.ai/developers/migration/may-15-retirement)。不把“未来计划下架”“legacy”直接视为“已经下架”。

## 同步范围

- 版本管理内：模型库、`service/config/global.config.example.json`、`user-template/default-user/config.example.json`。
- 本机实际配置（由 Git 忽略）：`service/config/global.config.json`、`user-template/default-user/config.json`、`workspace/admin/config.json`、`workspace/system/config.json`、`workspace/xiayu/config.json`。
- 新增条目的声明来自模型库；已有条目的自定义 API 地址、密钥变量、渠道前缀、启用状态和默认选择保留。删除旧型号时只迁移对应模型引用。
- 不修改历史会话、请求日志、模型调用历史或与本次型号无关的测试夹具。

模型库由进程导入，因此已有服务进程需要重新加载或重启后才能使用新的“从模型库添加”清单；配置文件已更新。各渠道的实际访问权限需由渠道返回结果确认。
