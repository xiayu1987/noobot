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
  UNKNOWN: "unknown",
});
export const MODEL_ERROR_CODE = Object.freeze({
  CREDENTIAL_MISSING: "MODEL_CREDENTIAL_MISSING",
  REASONING_RETRY_EXHAUSTED: "MODEL_REASONING_RETRY_EXHAUSTED",
});
export const MODEL_PURPOSE = Object.freeze({
  MAIN_AGENT: "main_agent",
  CAPABILITY: "capability",
  WORKFLOW_PLAN: "workflow_plan",
  WORKFLOW_REFINEMENT: "workflow_refinement",
  WORKFLOW_GUIDANCE: "workflow_guidance",
  WORKFLOW_ACCEPTANCE: "workflow_acceptance",
  MEMORY: "memory",
  DATA_PROCESSING: "data_processing",
  COLLABORATION: "collaboration",
  MCP: "mcp",
});
