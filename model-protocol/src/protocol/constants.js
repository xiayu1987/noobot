/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const MODEL_PROTOCOL_NAME = "noobot.model";
export const MODEL_PROTOCOL_VERSION = 1;
export const MODEL_REQUEST_STATUS = Object.freeze({
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
export const MODEL_INVOCATION_EVENT = Object.freeze({
  STARTED: "model.invocation.started",
  ATTEMPT_STARTED: "model.invocation.attempt_started",
  RETRY_SCHEDULED: "model.invocation.retry_scheduled",
  SEMANTIC_RETRY: "model.invocation.semantic_retry",
  STREAMING_MODE_RETRY: "model.invocation.streaming_mode_retry",
  COMPLETED: "model.invocation.completed",
  FAILED: "model.invocation.failed",
  CANCELLED: "model.invocation.cancelled",
});
export const MODEL_CONTEXT_TRACE = Object.freeze({
  EVENT: "model_context_trace",
  INVOKE_STAGE: "llm_invoke_messages",
  INVOKE_AUTHORITY: "model_invoke_port",
  PROTOCOL_VERSION: 2,
});
export const MODEL_ERROR_KIND = Object.freeze({
  PROTOCOL: "protocol",
  ABORTED: "aborted",
  AUTHENTICATION: "authentication",
  INVALID_REQUEST: "invalid_request",
  RATE_LIMIT: "rate_limit",
  TIMEOUT: "timeout",
  TEMPORARY_UNAVAILABLE: "temporary_unavailable",
  RESPONSE_MODE_MISMATCH: "response_mode_mismatch",
  TOOL_CALL_MISMATCH: "tool_call_mismatch",
  TOOL_CALL_INVALID: "tool_call_invalid",
  REASONING_ONLY: "reasoning_only",
  EMPTY_RESPONSE: "empty_response",
  UNKNOWN: "unknown",
  CLASSIFICATION: "classification",
});
export const MODEL_ERROR_CODE = Object.freeze({
  PROTOCOL: "MODEL_PROTOCOL_ERROR",
  CREDENTIAL_MISSING: "MODEL_CREDENTIAL_MISSING",
  RESPONSE_MODE_MISMATCH: "MODEL_RESPONSE_MODE_MISMATCH",
  REASONING_RETRY_EXHAUSTED: "MODEL_REASONING_RETRY_EXHAUSTED",
  EMPTY_RESPONSE_RETRY_EXHAUSTED: "MODEL_EMPTY_RESPONSE_RETRY_EXHAUSTED",
  TOOL_CALL_INVALID: "MODEL_TOOL_CALL_INVALID",
});
export const MODEL_ATTEMPT_STATUS = Object.freeze({
  COMPLETED: "completed",
  FAILED: "failed",
  RETRY: "retry",
});
export const MODEL_ATTEMPT_KIND = Object.freeze({
  TRANSPORT: "transport",
  RESPONSE: "response",
  REASONING_ONLY: "reasoning_only",
  EMPTY_RESPONSE: "empty_response",
  TOOL_CALL_STREAMING_MISMATCH: "tool_call_streaming_mismatch",
  TOOL_CALL_INVALID: "tool_call_invalid",
});
export const MODEL_RESPONSE_SOURCE = Object.freeze({
  MESSAGE: "message",
  RESPONSES: "responses",
});
