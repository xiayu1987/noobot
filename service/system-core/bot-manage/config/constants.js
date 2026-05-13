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

export const DEFAULT_TOOL_POLICY = {
  tools: {
    allowed: [],
    denied: [],
    mode: "whitelist",
  },
};
