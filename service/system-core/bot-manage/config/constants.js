/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

// ========================
// Async Domain Constants
// ========================

export const ASYNC_JOB_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

export const SESSION_ASYNC_STATUS = {
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  STOPPED: "stopped",
  ERROR: "error",
  NOT_FOUND: "not_found",
  INVALID_REQUEST: "invalid_request",
};

export const SESSION_ASYNC_TERMINAL_STATUSES = [
  SESSION_ASYNC_STATUS.COMPLETED,
  SESSION_ASYNC_STATUS.FAILED,
  SESSION_ASYNC_STATUS.STOPPED,
];

export const MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
  SYSTEM: "system",
  TOOL: "tool",
};

export const MESSAGE_TYPE = {
  MESSAGE: "message",
};

export const EXECUTION_LOG_EVENT = {
  SESSION_TURN_FULL: "session_turn_full",
};

export const BOT_MANAGE_LOG_SOURCE = {
  RUN_SESSION: "BotManager.runSession",
  ASYNC_RUN_SESSION: "AsyncSessionRunner.runAsyncSession",
  MEMORY_SUMMARIZE: "SessionExecutionEngine._runMemorySummarizeFlow",
  MEMORY_POSTPROCESS: "SessionExecutionEngine._runMemoryPostProcessFlow",
};

export const BOT_MANAGE_LOG_EVENT = {
  RUN_SESSION_FAILED: "run_session_failed",
  RUN_ASYNC_SESSION_FAILED: "run_async_session_failed",
  MEMORY_SUMMARY_FAILED: "memory_summary_failed",
  MEMORY_POSTPROCESS_FAILED: "memory_postprocess_failed",
};

export const CALLER_ROLE = {
  USER: "user",
  BOT: "bot",
};

export const VALID_CALLER_ROLES = Object.freeze(Object.values(CALLER_ROLE));

export const ASYNC_JOB_TYPES = {
  SESSION_EXECUTION: "session_execution",
  FILE_PROCESSING: "file_processing",
  MODEL_INFERENCE: "model_inference",
  CUSTOM: "custom",
};

export const DEFAULT_WAIT_ASYNC_TIMEOUT_MS = 120000;
export const MIN_WAIT_ASYNC_TIMEOUT_MS = 1000;
export const ASYNC_JOB_FAST_CLEANUP_MS = 1000;
export const ASYNC_JOB_RETENTION_MS = 5 * 60 * 1000;

export const DEFAULT_ASYNC_JOB_CONFIG = {
  pollInterval: 1000,
  maxWaitTime: 30000,
  retentionMs: ASYNC_JOB_RETENTION_MS,
};

// ========================
// Scenario Domain Constants
// ========================

export const SCENARIO_CONFIG_KEYS = [
  "tools",
  "context",
  "model",
  "scenarioConfig",
  "systemPrompt",
  "temperature",
  "maxTokens",
];

// ========================
// Tool Policy Constants
// ========================

export const TOOL_POLICY_MODE = {
  NONE: "none",
  WHITELIST: "whitelist",
  BLACKLIST: "blacklist",
};

export const VALID_TOOL_POLICY_MODES = Object.freeze(
  Object.values(TOOL_POLICY_MODE),
);

export const DEFAULT_TOOL_POLICY = {
  tools: {
    allowed: [],
    denied: [],
    mode: TOOL_POLICY_MODE.WHITELIST,
  },
};
