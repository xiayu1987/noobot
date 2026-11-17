# 图片与视频生成 / Image and video generation

模型模板以 [model-library.json](../model-protocol/model-library.json) 为准；运行时消费有效配置中
provider 的生成能力声明。接口枚举与输出类别约束见
[model-capabilities.js](../model-protocol/src/model/model-capabilities.js)，参数校验归
[`@noobot/model-protocol`](../model-protocol/README.md)，请求执行归
[`@noobot/model-runtime`](../model-runtime/README.md)。

Model templates live in the model library. Runtime capability checks use the active
provider configuration; the capability protocol defines API types and allowed outputs.
Parameter validation belongs to model-protocol and execution to model-runtime.

## 原生接口 / Native APIs

配置字段为 `providers.<alias>.multimodal_generation.support_generation`，启用时显式设置
`enabled`、`support_scope` 和 `api_type`。`dashscope_video` 还要求声明 `input_mode`。

Declare `enabled`, `support_scope`, and `api_type` in the provider generation capability.
DashScope video also requires an explicit `input_mode`.

| `api_type`                | 原生调用 / Native operation                               |
| ------------------------- | --------------------------------------------------------- |
| `openai_images`           | `images/generations`, multipart `images/edits`            |
| `xai_images`              | `images/generations`, `images/edits`                      |
| `gemini_generate_content` | `models/{model}:generateContent`                          |
| `gemini_interactions`     | `interactions`, background-task polling                   |
| `dashscope_multimodal`    | DashScope multimodal generation                           |
| `xai_video`               | `videos/generations`, `videos/{id}` polling               |
| `dashscope_video`         | `video-synthesis`, `tasks/{id}` polling                   |
| `minimax_video`           | `video_generation`, `query/video_generation/{id}` polling |

Agent 的 `multimodal_generate` 工具通过模型端口 `media_generation` 操作提交请求，
明确携带 `outputType: image | video`，返回带 MIME、文件名和内容来源的 `artifacts`，
再沿[附件链路](attachment-fact-source-architecture.md)交付。

The Agent's `multimodal_generate` tool submits a `media_generation` operation with
an explicit output type. Returned artifacts carry MIME type, filename, and content
source, and are delivered through the attachment pipeline.

## 参数与地址 / Parameters and endpoints

图片的 `size`、`resolution`、`n`、`quality`、`complexity`，以及视频的 `duration`、
`aspect_ratio`、`resolution` 和参考图均按所选模型的原生契约校验。
不适用的参数不能借用聊天参数解释，必填项不能由工具层猜填。

Image and video parameters follow the selected model's native contract. Required
parameters must be supplied explicitly rather than inferred by the tool.

`base_url` 必须对应所声明的原生接口；原生路径和聊天兼容路径可能不同。
地址和密钥沿用配置参数及环境变量解析，见[配置说明](../CONFIGURATION.zh-CN.md)。
当前型号和模板直接查询模型库，不在本文复制按日期的型号清单。

The endpoint must match the declared native API, which may differ from the chat
endpoint. Use the existing configuration parameter and environment-variable
resolution described in the [configuration guide](../CONFIGURATION.md).
Consult the model library for current templates. Template presence does not establish
account permission, regional availability, or successful live generation.
