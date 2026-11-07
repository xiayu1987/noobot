# 图片与视频模型库更新：2026-11-07

根据本次在线读取的厂商官方模型页、生成指南和退役公告，向 `model-protocol/model-library.json` 补充 18 个图片与视频模型模板，并同步全局配置示例。模型库版本从 1 升至 3，使已有版本化配置在服务启动升级时获得新增模板。

## 图片模型

| 厂商    | API 型号                      | 用途                               | 官方来源                                                                                |
| ------- | ----------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| OpenAI  | `gpt-image-2.6-sunburst`      | 精细图像生成与编辑                 | [Sunburst 模型页](https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst) |
| OpenAI  | `gpt-image-2.6-flare`         | 快速图像生成与编辑                 | [Flare 模型页](https://developers.openai.com/api/docs/models/gpt-image-2.6-flare)       |
| Google  | `gemini-nano-banana-2.1`      | 当前高效图片生成与多轮编辑         | [模型页](https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1)           |
| Google  | `gemini-3.1-flash-lite-image` | Nano Banana 2 Lite，低成本图片生成 | [图片生成指南](https://ai.google.dev/gemini-api/docs/image-generation)                  |
| Google  | `gemini-3-pro-image`          | Nano Banana Pro，复杂视觉任务      | [图片生成指南](https://ai.google.dev/gemini-api/docs/image-generation)                  |
| xAI     | `grok-imagine-image-2.0`      | 图片生成                           | [图片生成指南](https://docs.x.ai/developers/model-capabilities/images/generation)       |
| Alibaba | `qwen-image-3.0-pro`          | 图片生成与中英文文字渲染           | [图像生成](https://help.aliyun.com/zh/model-studio/text-to-image)                       |
| Alibaba | `wan2.7-image-pro`            | 图片生成与编辑，文生图最高 4K      | [图像生成](https://help.aliyun.com/zh/model-studio/text-to-image)                       |
| Alibaba | `wan2.7-image`                | 图片生成与编辑                     | [图像生成](https://help.aliyun.com/zh/model-studio/text-to-image)                       |

## 视频模型

| 厂商    | API 型号                      | 用途                               | 官方来源                                                                           |
| ------- | ----------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| Google  | `gemini-omni-1.2-flash`       | 视频生成、多轮编辑和续写           | [Omni 视频指南](https://ai.google.dev/gemini-api/docs/omni)                        |
| xAI     | `grok-imagine-video-1.5`      | 有声视频生成                       | [视频生成指南](https://docs.x.ai/developers/model-capabilities/video/generation)   |
| xAI     | `grok-imagine-video-1.5-lite` | 低成本有声视频生成                 | [视频生成指南](https://docs.x.ai/developers/model-capabilities/video/generation)   |
| Alibaba | `wan3.0-video`                | 文生、首尾帧与参考视频生成         | [视频模型列表](https://help.aliyun.com/zh/model-studio/video-generate-edit-model/) |
| Alibaba | `wan3.0-video-prime`          | Wan 3.0 优速版                     | [视频模型列表](https://help.aliyun.com/zh/model-studio/video-generate-edit-model/) |
| Alibaba | `happyhorse-1.1-t2v`          | 文生有声视频                       | [视频模型列表](https://help.aliyun.com/zh/model-studio/video-generate-edit-model/) |
| Alibaba | `happyhorse-1.1-i2v`          | 首帧图片生成有声视频               | [视频模型列表](https://help.aliyun.com/zh/model-studio/video-generate-edit-model/) |
| Alibaba | `happyhorse-1.1-r2v`          | 参考图片生成视频                   | [视频模型列表](https://help.aliyun.com/zh/model-studio/video-generate-edit-model/) |
| MiniMax | `MiniMax-H3`                  | 文生、图生、首尾帧及多模态参考视频 | [官方模型列表](https://platform.minimax.io/docs/guides/models-intro)               |

## 接口边界

新增模板已启用生成能力并显式声明 `api_type`，全部 `used_for_conversation: false`，不会成为聊天模型。模型库是型号、接口类型和生成类别的唯一事实来源；版本升级同步内置模型声明，保留凭据和自定义模型。

生成统一走模型端口的 `media_generation` 操作，输入明确携带 `outputType: image | video`，产物统一为声明 MIME、文件名及唯一内容来源的 `artifacts`。Agent 沿用现有 `multimodal_generate` 入口与附件返回链路，运行时直接请求厂商原生 API，不调用 Responses 的 `image_generation` 工具。旧 `images_async` 网关执行分支及主机路径猜测已删除；升级器同步内置模型的原生接口声明，保留用户配置的密钥和地址；地址须对应原生协议，自定义配置必须显式更新。

| 接口声明                  | 原生调用                                                                |
| ------------------------- | ----------------------------------------------------------------------- |
| `openai_images`           | `images/generations`，参考图编辑使用 multipart `images/edits`           |
| `xai_images`              | xAI `images/generations` / `images/edits`，JPEG 产物                    |
| `gemini_generate_content` | 原生 `models/{model}:generateContent`                                   |
| `gemini_interactions`     | 原生 `interactions`；Omni 后台任务轮询                                  |
| `dashscope_multimodal`    | DashScope 多模态生成接口                                                |
| `xai_video`               | `videos/generations` 创建及 `videos/{id}` 轮询                          |
| `dashscope_video`         | `video-synthesis` 创建及 `tasks/{id}` 轮询；输入模式由模型声明          |
| `minimax_video`           | MiniMax v2 `video_generation` 创建及 `query/video_generation/{id}` 轮询 |

图片使用已有 `size`、`resolution`、`n`、`quality` 和参考图片 URL；OpenAI 2.6 另支持独立 `complexity` 字段，不混用聊天推理参数。视频使用 `output_type: video`、`duration`（秒）、`aspect_ratio`、`resolution` 和参考图片 URL。参数遵循厂商原生定义；MiniMax H3 必须指定时长、分辨率，非单图模式还需比例，不填不会擅自选值。HappyHorse 三种型号严格按文生、单图、参考图模式校验。

模型库和全局配置示例中的 `base_url` 均使用 `${...}` 参数引用。沿用配置协议的 `config-params.json` / 环境变量解析和缺失参数检测，不另建地址注册表或运行时默认值。OpenAI、xAI 复用已有地址参数；原生路径与聊天兼容路径不同的厂商使用独立参数：

| 地址参数                       | 配置值示例                                         |
| ------------------------------ | -------------------------------------------------- |
| `OPENAI_API_ADDRESS`           | `https://api.openai.com/v1`                        |
| `XAI_API_ADDRESS`              | `https://api.x.ai/v1`                              |
| `GEMINI_NATIVE_API_ADDRESS`    | `https://generativelanguage.googleapis.com/v1beta` |
| `DASHSCOPE_NATIVE_API_ADDRESS` | `https://dashscope.aliyuncs.com/api/v1`            |
| `MINIMAX_VIDEO_API_ADDRESS`    | `https://api.minimax.io/v2`                        |

配置示例增加视频默认模型 `grok_imagine_video_1_5`。使用前需配置相应厂商密钥和可用地区接口地址。原生地址与聊天兼容地址独立声明，不能混用 `/openai` 或 MiniMax v1 路径。

任务轮询支持取消和总体超时，未知状态、空产物、错误响应及 MIME 不符会明确失败。生成提交不自动重试，避免重复计费；下载参考图和产物不携带厂商凭据。自动化测试以官方请求、响应结构验证协议转换和附件链路；本次未进行付费线上生成，账户权限、地区可用性及真实生成质量仍待持有密钥的环境验证。

## 已下线与过渡型号

- OpenAI 官方指南明确：Sora 2 模型和 Videos API 已于 **2026-09-24** 关闭，且没有一对一替代 API，因此不新增 `sora-2` 或 `sora-2-pro`。[官方说明](https://developers.openai.com/api/docs/guides/video-generation)
- Google 官方指南明确：Veo 3.1 Preview（含 Fast、Lite）已于 **2026-10-22** 关闭，应迁移至 Gemini Omni，因此不新增这些 Veo Preview 型号。[官方说明](https://ai.google.dev/gemini-api/docs/video)
- `gemini-omni-1.1-flash` 仍处于过渡期，官方宣布 **2026-12-03** 自动转发至 1.2；本次直接添加当前推荐的 1.2。[官方说明](https://ai.google.dev/gemini-api/docs/omni)
- Nano Banana 2 的 `gemini-3.1-flash-image` 是上一代，官方建议新项目使用 2.1。本次补最新的高效、Lite 和 Pro 档位，未重复增加旧高效型号。[官方说明](https://ai.google.dev/gemini-api/docs/image-generation)

本次未调用付费生成 API。官方发布状态不代表具体账户、地域或第三方网关已有访问权限。运行配置在下次服务启动时按现有升级流程加入缺失模板；同名已有配置和默认模型选择由原升级逻辑保留。
