# @noobot/model-protocol

调用观测事件统一使用 `MODEL_INVOCATION_EVENT`。每次失败的 provider attempt 记录在
`execution.attempts`；调用最终失败时恰好发出一次 `FAILED` 事件，载荷由协议投影为
attempt 数、错误消息、错误码和错误类型。每个 attempt 错误只由 `projectModelAttemptError`
投影为冻结的 `{ message, code, kind, retryable, classificationError }`，`execution.attempts`、
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
`{ kind, retryable, classificationError }`：仅 `ModelProtocolError` 自带声明分类，其余错误
一律交给适配器 `classifyError`；适配器结果的 `kind` 必须是 `MODEL_ERROR_KIND`（不得声明
`classification`），`retryable` 必须是布尔值，否则归类为 `classification`。
适配器只沿 `cause` 链读取结构化字段（`name`、`code`、`status`）分类，错误文本不参与重试判定。
成功响应的传输模式与请求不符（仅在请求流式时应为 SSE）时，抛出 kind 为
`response_mode_mismatch`、code 为 `MODEL_RESPONSE_MODE_MISMATCH` 的 `ModelProtocolError`，
不可重试。执行器在尚未输出流式 token 时切换一次流式模式，kind 为 `aborted`、
`authentication`、`rate_limit`、`classification` 时不切换。供应商 SDK 重试关闭，执行器是唯一重试权威。
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

请求前缀计量按 HTTP 请求体的 UTF-8 字节，与同一 executor、同一 scope 内的上一请求
精确比较。scope 包括会话、父会话、端点 origin 与路径、模型、flow 和 operation。
新 executor 没有基线；该指标不代表完整会话的前缀复用率或供应商缓存命中率。
每个 scope 只保留最新请求体，并随 executor 释放；非字符串请求体清除该 scope 的基线，
报告 `unsupported`，首次字符串请求体报告 `no_previous_request`。
