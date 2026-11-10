# @noobot/model-protocol

调用观测事件统一使用 `MODEL_INVOCATION_EVENT`。每次失败的 provider attempt 记录在
`execution.attempts`；调用最终失败时恰好发出一次 `FAILED` 事件，载荷由协议投影为
attempt 数、错误消息、错误码和错误类型。每个 attempt 错误只由 `projectModelAttemptError`
投影为冻结的 `{ message, code, kind, classificationError }`，`execution.attempts`、
`STREAMING_MODE_RETRY` 与 `FAILED.failedAttempts` 共用该结构；`message` 为原始错误文本，可为空。
可重试的中间失败不发终态失败事件。调用取消时发出
`CANCELLED` 而非 `FAILED`；成功调用发出 `COMPLETED`。

观测从请求校验和 provider 解析完成后开始。凭证、响应来源、客户端创建及装饰、
operation 初始化失败时，若尚未开始 provider attempt，发出 attempt 数为零的 `FAILED`，
不虚构 attempt。已经开始的传输失败和响应规范化失败统一记录 `FAILED` attempt。
终态 `failedAttempts` 从这些记录投影，保留各次实际编号、类别和 attempt 错误，
不得用最终错误覆盖历史错误。中间失败后重试成功时，记录保留在 `execution.attempts`，
终态只发 `COMPLETED`。取消不记录失败 attempt，也不发 `FAILED`。
错误分类器抛错或返回非法结果时，显式归类为 `classification`，通过
`classificationError` 保留分类错误文本，禁止传输及流式模式重试；原调用异常保持原样抛出。
每次调用内，同一个错误只分类一次。
失败分类的唯一入口是 `classifyModelFailure`，结果固定为冻结的
`{ kind, classificationError }`：仅 `ModelProtocolError` 自带声明分类，其余错误
一律交给适配器 `classifyError`；适配器结果的 `kind` 必须是 `MODEL_ERROR_KIND`（不得声明
`classification`），非法结果归类为 `classification`。不另设可重试标志，恢复动作是重试的唯一依据。
适配器读取结构化字段（`name`、`code`、`type`、`status`、headers）分类，错误文本不参与重试判定。
成功响应的传输模式与请求不符（仅在请求流式时应为 SSE）时，抛出 kind 为
`response_mode_mismatch`、code 为 `MODEL_RESPONSE_MODE_MISMATCH` 的 `ModelProtocolError`，
由 `resolveModelFailureRecovery` 决策恢复：模式不匹配时切换到本次调用尚未尝试的声明模式，
全部尝试后停止；明确限流、超时、临时不可用及未知／未登记供应商错误在传输预算内保持参数重试；
其他失败停止。
传输、模式切换和空响应重试统一通过 `resolveModelRetryDelay` 指数退避；有效的
`Retry-After` 作为最小等待时间，不另设重试预算。
指数退避上限统一取 `TIME_THRESHOLDS.model.maxRetryDelayMs`（默认 60 秒）；上游最小等待
超过上限时显式协议失败，不截短后提前请求。时钟端口契约为 `sleep(ms, { signal })`：
取消立即拒绝等待并释放定时器与监听器，所有恢复等待都消费调用信号。
执行控制只通过 `options.signal`、`options.callbacks` 和 `options.streaming` 传入；
`options.invoke` 禁止携带 `signal`、`callbacks`、`stream` 和 `streaming`。
输出进度 `outputObserved` 只由 `hasModelStreamOutput` 判定的传输事件产生，即使没有业务回调也记录，
`mayReplayModelRequest` 是唯一重放门控；响应校验成功后才缓存模式。非流式 Responses 要求 JSON
媒体类型，SDK 通过 `asResponse()` 提供原始响应，传输层通过 `Response.json()` 将单次解码
结果共享给计量与适配器校验。协议校验先于 SDK 输出投影和规范化，畸形正文不进入转换重试。
所有重试共享 `maxTotalAttempts`（包含首次请求），传输重试还受每种模式的预算限制。非法重试配置
（非整数、负数、总次数小于 1）直接报错，不做纠正。
已有输出或取消后禁止重放；operation 只切换至声明可用的模式，媒体提交禁止自动重放。
诊断总预算固定为一次。重试事件携带 `retryCount/maxRetries`；宿主用 invocation 范围内固定
activityId 覆盖同一条 `model_retry` 活动，计数增长不追加展示消息。
供应商 SDK 重试关闭，执行器是唯一重试权威。

供应商规则只维护在 `src/policy/provider-failure-policy.js`，按 operator 隔离，不按 SDK
异常类或模型系列套用；`google` 与 `gemini` 引用同一份 Google 规则。
适配器提取事实，`resolveModelFailureRecovery` 决策动作，执行器管理尝试。

| 供应商／依据                                                                  | 保持参数重试                 | 停止                                                     | 未知错误（保持参数重试）                                               |
| ----------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| [OpenAI](https://developers.openai.com/api/docs/guides/error-codes)           | 明确限流、超时、临时服务错误 | 认证、额度不足、非法请求、内容策略                       | 无法分类的错误                                                         |
| [Anthropic](https://platform.claude.com/docs/en/api/errors)                   | 明确 rate_limit_error、过载  | 402 账单错误、enforced_spend_limit_reached               | 含义不明的 429、其他未知错误                                           |
| [Google／Gemini](https://ai.google.dev/gemini-api/docs/troubleshooting)       | 超时、内部错误、服务不可用   | 认证、非法请求                                           | 无法区分的 RESOURCE_EXHAUSTED、其他未知错误                            |
| [DeepSeek](https://api-docs.deepseek.com/quick_start/error_codes)             | 429、500、503、超时          | 402、认证、非法请求                                      | 未知错误                                                               |
| [阿里](https://help.aliyun.com/zh/model-studio/error-code)                    | 明确速率限制、服务过载       | Arrearage 欠费                                           | 无法区分的分配额度错误、其他未知错误                                   |
| [智谱](https://docs.bigmodel.cn/cn/api/api-code)                              | 1302、1305、临时服务错误     | 1113、1308–1310、非法输入及内容                          | 未知错误                                                               |
| [Kimi 官方支持论坛](https://forum.moonshot.ai/t/429-insufficient-balance/244) | 不登记未经核实的临时错误码   | exceeded_current_quota_error（论坛证据，API 契约待验证） | 其余未核实错误，包括 rate_limit_reached_error、engine_overloaded_error |
| [xAI](https://docs.x.ai/developers/debugging)                                 | 429、500、503                | 下述通用认证／请求策略                                   | 未知错误，包括未登记的 402                                             |
| 未登记供应商／扩展                                                            | 仅已识别的传输失败           | 认证、取消、本地协议违例                                 | 无法区分的上游错误                                                     |

通用运行时策略：所有 operator 的 HTTP 401/403 停止；已登记供应商的 400/404/413/422 在没有
结构化错误码覆盖时按非法请求停止。这是本地 HTTP 策略，不宣称是供应商专属错误码契约。
只有 DeepSeek 和 Anthropic 登记 402 额度／账单语义；其他未登记的 402 保持未知。
错误码只在所属 operator 内生效，供应商扩展不继承 OpenAI 错误码含义。
未知错误原参重试属于有界恢复策略，不声明重试一定能修复。重试计数按已调度次数与总预算上限展示，
分类子预算可能提前结束；活动更新保留为事件，但投影后只有一条可见活动。

`invocation.requestId` 与 `invocation.invocationId` 由模型宿主每次调用独占生成，调用方只
描述 `flow`、`purpose`、`domain`、`contextSequencePolicy`；会话范围身份由
`requireInvocationScope` 按 canonical 文本校验，执行器只校验、不生成身份。
`request.metadata` 仅允许 `context`，且与 `contextSequencePolicy` 绑定：
`checkpoint_append_only` 必须携带非负整数 `context.summaryCheckpointRevision`，其他策略禁止携带。
上下文观测事件统一使用 `MODEL_CONTEXT_TRACE`（`EVENT`、`INVOKE_STAGE`、`INVOKE_AUTHORITY`、
`PROTOCOL_VERSION`），各模块不得另写字面量。
重试策略的 `maxAttempts` 与 `baseDelayMs` 只由 `normalizeRetryPolicy` 规范化。

版本化、无副作用的模型请求、响应、策略及宿主端口协议。

工具执行只消费规范化响应的 `output.toolCalls`。Responses API 的完整终态
`responseOutput` 是调用顺序、调用身份和参数的权威来源；流式增量只用于过程展示，
不得覆盖终态参数或与其合并。function_call 的 arguments 必须解析为普通对象；
custom_tool_call 的 input 投影为 `{ input }`，computer_call 的 action 投影为
`computer_use` 的 `{ action }`。服务端内置工具调用不作为宿主工具执行。
终态参数非法时显式归类为协议非法调用，不使用流式参数兜底。

每个 provider 适配器必须通过 `resolveResponseSource({ modelSpec })` 显式声明响应来源，
取值为 `MODEL_RESPONSE_SOURCE.MESSAGE` 或 `MODEL_RESPONSE_SOURCE.RESPONSES`；规范化不得
根据响应形态推断来源。`RESPONSES` 结果必须带终态 `output` 与 `status`，`finishReason`
取 `status`，状态为 `incomplete` 时取 `incomplete_details.reason`，任一事实缺失即抛出
`ModelProtocolError`。`MESSAGE` 结果的 `finishReason` 取 `finish_reason`。流式工具调用
不一致恢复只适用于 `MESSAGE` 结果。
支持 operation 的适配器必须成对声明 `executeOperation` 与
`resolveOperationStreamingModes({ modelSpec, operation })`，后者返回非空、不重复的布尔列表
（`requireOperationStreamingModes`）。执行器优先使用已声明的偏好模式，否则取首个声明模式，
只切换到已声明的模式。

`ModelProtocolError` 默认分类为 `protocol` 且不可重试；畸形响应或缺失终止帧不得隐式
重放，也不触发流模式切换。显式声明的其他错误类别继续遵循各自策略。

输出进度仅来自传输事件，并由 `hasModelStreamOutput` 统一判定：非空文本、推理、拒绝及
工具调用计为输出；角色、空增量和生命周期元数据不计。业务回调只负责通知，不决定重放安全性。
成功的供应商正文必须通过严格 UTF-8 和 JSON 解码（流式逐 SSE 数据帧校验）。解码失败以
保留原始 cause 的 `ModelProtocolError` 中断正文消费、取消上游读取，并记录唯一失败请求终态。
SDK 不得消费替换字符，也不得将解码失败改写为缺失终态；调用失败且不重试、不切换模式。
正文取消仅在 signal 已中止时记为 `cancelled`；消费者拒绝而无中止信号时记为 `failed`，
已记录供应商终态的请求不再改写终态。
计量与适配器复用同一解码响应或流事件对象的终态校验结果；这些对象在 SDK 投影前不得修改，
校验记录使用弱引用。
普通及结构化响应均在最终投影后附加不可枚举的 `_request_id`。

请求前缀计量按 HTTP 请求体的 UTF-8 字节，与同一 executor、同一 scope 内的上一请求
精确比较。scope 包括会话、父会话、端点 origin 与路径、模型、flow 和 operation。
新 executor 没有基线；该指标不代表完整会话的前缀复用率或供应商缓存命中率。
每个 scope 只保留最新请求体，并随 executor 释放；非字符串请求体清除该 scope 的基线，
报告 `unsupported`，首次字符串请求体报告 `no_previous_request`。
缓存属于 executor，保留字节数等于各 scope 最新正文的总和，不随同 scope 的调用次数累加。
executor 由单次运行持有，不应置于进程级共享池；没有会静默改变前缀事实的自动淘汰或固定字节上限。
