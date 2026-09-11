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
export const MODEL_ERROR_KIND = Object.freeze({
  ABORTED: "aborted",
  AUTHENTICATION: "authentication",
  INVALID_REQUEST: "invalid_request",
  RATE_LIMIT: "rate_limit",
  TIMEOUT: "timeout",
  TEMPORARY_UNAVAILABLE: "temporary_unavailable",
  TOOL_CALL_MISMATCH: "tool_call_mismatch",
  REASONING_ONLY: "reasoning_only",
  EMPTY_RESPONSE: "empty_response",
  UNKNOWN: "unknown",
});
export const MODEL_ERROR_CODE = Object.freeze({
  PROTOCOL: "MODEL_PROTOCOL_ERROR",
  CREDENTIAL_MISSING: "MODEL_CREDENTIAL_MISSING",
  REASONING_RETRY_EXHAUSTED: "MODEL_REASONING_RETRY_EXHAUSTED",
  EMPTY_RESPONSE_RETRY_EXHAUSTED: "MODEL_EMPTY_RESPONSE_RETRY_EXHAUSTED",
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
});
