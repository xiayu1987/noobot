# @noobot/model-protocol

Versioned, side-effect-free model request, response, policy and host-port contracts.

Tool execution consumes only canonical `output.toolCalls`. For the Responses API,
the complete terminal `responseOutput` is authoritative for call order, identity and
arguments. Streaming deltas serve progress presentation and must neither override
nor merge with terminal arguments. Function-call arguments must decode to a plain
object; custom-tool input maps to `{ input }`, and computer-call action maps to
`computer_use` with `{ action }`. Provider-managed calls do not execute as host tools.
Invalid terminal arguments are classified as protocol-invalid calls without falling
back to streaming arguments.

Each provider adapter must declare its response source through
`resolveResponseSource({ modelSpec })`, returning `MODEL_RESPONSE_SOURCE.MESSAGE` or
`MODEL_RESPONSE_SOURCE.RESPONSES`; normalization never infers the source from response
shape. A `RESPONSES` result requires terminal `output` and `status`; its `finishReason`
is `status`, or `incomplete_details.reason` when the status is `incomplete`, and any
missing fact raises `ModelProtocolError`. A `MESSAGE` result takes `finishReason` from
`finish_reason`. Streaming tool-call mismatch recovery applies only to `MESSAGE` results.
An adapter that supports operations declares `executeOperation` together with
`resolveOperationStreamingModes({ modelSpec, operation })`, which returns a non-empty list of
distinct booleans (`requireOperationStreamingModes`). The executor uses the preferred mode
when declared, otherwise the first declared mode, and switches only to a declared mode.

Invocation observation uses `MODEL_INVOCATION_EVENT`. Each failed provider attempt is
recorded in `execution.attempts`; a terminal invocation failure emits exactly one
`FAILED` event with the protocol-projected attempt count, error message, error code and
error kind. Every attempt error is projected only by `projectModelAttemptError` as a
frozen `{ message, code, kind, retryable, classificationError }`; `execution.attempts`,
`STREAMING_MODE_RETRY` and `FAILED.failedAttempts` share that shape. `message` is the
original error text and may be empty.
Retryable attempts do not emit terminal failure. Aborted invocations emit `CANCELLED`
instead of `FAILED`; successful invocations emit `COMPLETED`.

Observation starts after request validation and provider resolution. Failures in
credential resolution, response-source resolution, client creation/decorating or
operation setup emit `FAILED` with zero attempts when no provider attempt has begun;
they never fabricate a provider attempt. Once started, transport and response
normalization failures record `FAILED` attempts through the same recording path.
Terminal `failedAttempts` is projected from those records and preserves each attempt's
own number, category and attempt error. Intermediate failures followed by
success remain in `execution.attempts` and emit only `COMPLETED` as the terminal event.
Cancellation does not record a failed attempt and never emits `FAILED`.
An error-classifier exception or invalid result is explicitly classified as
`classification`, with `classificationError` retaining the classifier error text;
it cannot trigger transport or streaming-mode retries. The original invocation
exception is rethrown unchanged. Classification is evaluated once per error per invocation.
`classifyModelFailure` is the only classification entry and always returns a frozen
`{ kind, retryable, classificationError }`. Only `ModelProtocolError` carries a declared
classification; every other error is classified by the adapter's `classifyError`, whose
`kind` must be a `MODEL_ERROR_KIND` other than `classification`; the protocol alone derives
`retryable` from kind. Invalid classifier results become `classification`.
Adapters classify structured error fields (`name`, `code`, `type`, `status`, headers) along the
`cause` chain; message text never decides retries. A successful provider response whose
transfer mode differs from the requested one (SSE exactly when streaming was requested)
is a `ModelProtocolError` with kind `response_mode_mismatch` and code
`MODEL_RESPONSE_MODE_MISMATCH`. Recovery actions are defined by `resolveModelFailureRecovery`:
unknown/unregistered provider errors and mode mismatches change the streaming parameter
before retrying; rate limits, timeouts and temporary failures retry unchanged. Other kinds stop.
Transport, mode-change and empty-response retries use `resolveModelRetryDelay` for exponential
backoff; a valid provider `Retry-After` is a minimum wait, not a separate retry budget.
Exponential delays are capped by `TIME_THRESHOLDS.model.maxRetryDelayMs` (60 seconds by default).
A provider minimum above this limit ends with an explicit protocol failure; it is never shortened.
The clock port contract is `sleep(ms, { signal })`: cancellation rejects immediately and releases
the timer and listener. All recovery waits use the invocation signal.
`options.signal`, `options.callbacks` and `options.streaming` are executor-owned controls;
`options.invoke` must not contain `signal`, `callbacks`, `stream` or `streaming`.
Output progress comes only from transport events classified by `hasModelStreamOutput`:
non-empty text, reasoning, refusals and tool calls count; roles, empty deltas and lifecycle
metadata do not. Caller callbacks only deliver notifications and never decide replay safety.
Preferred modes are cached only after response validation succeeds. Non-stream Responses require a JSON media type. The transport
shares its decoded JSON with measurement and adapter validation through `Response.json()`;
the SDK supplies the raw response through `asResponse()`. Protocol validation precedes SDK
output projection and normalization, so malformed bodies never enter SDK conversion retries.
Successful provider bodies require strict UTF-8 and valid JSON (per SSE data frame when streaming).
Decode failures are `ModelProtocolError`s with their original cause: they fail body consumption,
cancel the upstream reader and record one failed request terminal. SDK consumers must not receive
replacement text or reinterpret a decoding failure as a missing terminal. The invocation fails
without retry or mode switching. Cancelling a body is `cancelled` only when its signal is aborted;
consumer rejection without an abort is `failed` unless a provider terminal was already recorded.
Measurement and adapters reuse terminal validation for the same decoded response or stream event;
those objects must remain unchanged until SDK projection. Validation entries use weak references.
The final ordinary or structured result receives the non-enumerable `_request_id` after projection.
All retries share `maxTotalAttempts` (including the initial request); transport retries also
respect their per-mode budget. No retries follow output or cancellation. Operations only
change to declared modes; media submissions are never automatically replayed. Diagnostics
set the total budget to one. Retry events carry `retryCount` and `maxRetries`; the host
updates a single `model_retry` activity per invocation using a stable activity ID.
Provider SDK retries are disabled; the executor is
the only retry authority. A `ModelProtocolError` defaults to kind `protocol` and is
not retryable: malformed or unterminated responses must not be replayed implicitly.

Provider rules live only in `src/policy/provider-failure-policy.js`, scoped by operator,
not SDK class or model family. `google` and `gemini` reference the same Google rules.
Adapters extract facts; `resolveModelFailureRecovery` owns actions; the executor owns attempts.

| Provider / source                                                                       | Retry unchanged                                          | Stop                                                                   | Change streaming and retry                                                             |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [OpenAI](https://developers.openai.com/api/docs/guides/error-codes)                     | Structured rate limit, timeout, temporary server failure | Authentication, insufficient quota, invalid request, content policy    | Unclassified failures                                                                  |
| [Anthropic](https://platform.claude.com/docs/en/api/errors)                             | Structured rate_limit_error, overload                    | 402 billing error, `enforced_spend_limit_reached`                      | Ambiguous 429 and unclassified failures                                                |
| [Google / Gemini](https://ai.google.dev/gemini-api/docs/troubleshooting)                | Timeout, internal/unavailable                            | Authentication, invalid request                                        | Ambiguous RESOURCE_EXHAUSTED and unclassified failures                                 |
| [DeepSeek](https://api-docs.deepseek.com/quick_start/error_codes)                       | 429, 500, 503, timeout                                   | 402, authentication, invalid request                                   | Unclassified failures                                                                  |
| [Alibaba](https://help.aliyun.com/zh/model-studio/error-code)                           | Explicit rate quota and service overload                 | Arrearage                                                              | Ambiguous allocation quota and unclassified failures                                   |
| [Zhipu](https://docs.bigmodel.cn/cn/api/api-code)                                       | 1302, 1305, temporary server failure                     | 1113, 1308–1310, invalid input/content                                 | Unclassified failures                                                                  |
| [Kimi official support forum](https://forum.moonshot.ai/t/429-insufficient-balance/244) | No unverified transient code registered                  | exceeded_current_quota_error (forum evidence; API contract unverified) | Other unverified codes, including rate_limit_reached_error and engine_overloaded_error |
| [xAI](https://docs.x.ai/developers/debugging)                                           | 429, 500, 503                                            | Shared authentication/request policy below                             | Unclassified failures, including undocumented 402                                      |
| Unregistered provider / extension                                                       | Only recognized transport failures                       | Authentication, cancellation, local protocol violations                | Unclassified upstream errors                                                           |

Shared runtime policy stops HTTP 401/403 for every operator. Registered providers also stop
400/404/413/422 as invalid requests when no structured code overrides that classification;
this is a local HTTP policy, not a claim about provider-specific error codes. Only DeepSeek
and Anthropic register 402 as quota/billing failure. Other undocumented 402 errors remain unknown.
Known code mappings are scoped to their operator; extensions never inherit OpenAI code meanings.
These are bounded recovery policies, not claims that parameter changes repair unknown errors.
Retry counters describe retries scheduled against the total ceiling; per-category budgets may
end earlier. Repeated activity updates are retained as events but reduce to one visible activity.

Request prefix measurements compare exact UTF-8 HTTP body bytes against the immediately
preceding request in the same executor and scope (session, parent session, endpoint origin
and path, model, flow and operation). A new executor has no baseline; this is not a
session-wide prefix reuse rate or provider cache-hit metric. Each scope retains only its
latest body until executor disposal. Non-string bodies clear the scope baseline and
report `unsupported`; the first string body reports `no_previous_request`.
The cache belongs to the executor, with retained bytes equal to the sum of the latest bodies
in its scopes, not the number of calls. Executors are owned by a run, not a process-wide pool;
there is no automatic eviction or fixed byte limit that could silently invalidate prefix facts.
The model host alone mints `invocation.requestId` and `invocation.invocationId` per call;
callers only describe `flow`, `purpose`, `domain` and `contextSequencePolicy`. Session scope is
validated as canonical text by `requireInvocationScope`; the executor validates and never
generates identity. Retry `maxAttempts` and `baseDelayMs` are normalized only by
`normalizeRetryPolicy`.
`request.metadata` only allows `context`, bound to `contextSequencePolicy`:
`checkpoint_append_only` requires a non-negative integer `context.summaryCheckpointRevision`;
every other policy must not carry it.
Context observation uses `MODEL_CONTEXT_TRACE` (`EVENT`, `INVOKE_STAGE`, `INVOKE_AUTHORITY`,
`PROTOCOL_VERSION`); modules must not restate these literals.
