/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TASK_STATUS = Object.freeze({
  COMPLETED: "completed",
  FAILED: "failed",
  FULFILLED: "fulfilled",
  PARTIAL: "partial",
  REJECTED: "rejected",
  RUNNING: "running",
  USER_STOPPED: "user_stopped",
  UNKNOWN: "unknown",
});

export const SESSION_ASYNC_STATUS = {
  RUNNING: TASK_STATUS.RUNNING,
  COMPLETED: TASK_STATUS.COMPLETED,
  FAILED: TASK_STATUS.FAILED,
  USER_STOPPED: TASK_STATUS.USER_STOPPED,
};

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
  MEMORY_SUMMARIZE: "SessionExecutionEngine._runMemorySummarizeFlow",
  MEMORY_POSTPROCESS: "SessionExecutionEngine._runMemoryPostProcessFlow",
  MEMORY_INJECTION: "ContextBuilder._resolveLongMemoryForInjection",
};

export const BOT_MANAGE_LOG_EVENT = {
  RUN_SESSION_FAILED: "run_session_failed",
  MEMORY_SUMMARY_FAILED: "memory_summary_failed",
  MEMORY_POSTPROCESS_FAILED: "memory_postprocess_failed",
  MEMORY_INJECTION_FAILED: "memory_injection_failed",
};
