/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

/**
 * 工具调用结果追踪截断长度（字符数）
 * 用于 traces 中 result 字段的长度限制
 */
export const TOOL_RESULT_TRACE_TRUNCATE_LENGTH =
  LENGTH_THRESHOLDS.display.toolResultTraceChars;

/**
 * LLM transient retry configuration.
 */
export const TRANSIENT_LLM_MAX_ATTEMPTS =
  TURN_THRESHOLDS.agent.transientLlmMaxAttempts;
export const TRANSIENT_LLM_RETRY_BASE_DELAY_MS =
  TIME_THRESHOLDS.agent.transientLlmRetryBaseDelayMs;
