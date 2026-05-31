/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * 工具调用结果追踪截断长度（字符数）
 * 用于 traces 中 result 字段的长度限制
 */
export const TOOL_RESULT_TRACE_TRUNCATE_LENGTH = 1000;

/**
 * LLM transient retry configuration.
 */
export const TRANSIENT_LLM_MAX_ATTEMPTS = 2;
export const TRANSIENT_LLM_RETRY_BASE_DELAY_MS = 500;
