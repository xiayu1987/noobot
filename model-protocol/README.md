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
`kind` must be a `MODEL_ERROR_KIND` other than `classification` and whose `retryable` must
be boolean, otherwise the failure is classified as `classification`.
Adapters classify only structured error fields (`name`, `code`, `status`) along the
`cause` chain; message text never decides retries. A successful provider response whose
transfer mode differs from the requested one (SSE exactly when streaming was requested)
is a `ModelProtocolError` with kind `response_mode_mismatch` and code
`MODEL_RESPONSE_MODE_MISMATCH`, not retryable. The executor switches the streaming mode
once, before any streamed token, unless the kind is `aborted`, `authentication`,
`rate_limit`, `protocol` or `classification`. Provider SDK retries are disabled; the executor is
the only retry authority. A `ModelProtocolError` defaults to kind `protocol` and is
not retryable: malformed or unterminated responses must not be replayed implicitly.

Request prefix measurements compare exact UTF-8 HTTP body bytes against the immediately
preceding request in the same executor and scope (session, parent session, endpoint origin
and path, model, flow and operation). A new executor has no baseline; this is not a
session-wide prefix reuse rate or provider cache-hit metric. Each scope retains only its
latest body until executor disposal. Non-string bodies clear the scope baseline and
report `unsupported`; the first string body reports `no_previous_request`.
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
