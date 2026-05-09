/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * 引擎 I18n 键名映射
 */
export const ENGINE_I18N_KEY_MAP = {
  toolLoopLimitReached: "agent.toolLoopLimitReached",
  toolConsecutiveFailureLimitReached:
    "agent.toolConsecutiveFailureLimitReached",
  fetchGeneratedMediaFailed: "agent.fetchGeneratedMediaFailed",
  fetchRemoteMediaArtifactFailed: "agent.fetchRemoteMediaArtifactFailed",
  abortError: "agent.abortError",
};

/**
 * 工具调用连续失败次数上限
 * 达到此值后自动终止该工具后续调用
 */
export const TOOL_CONSECUTIVE_FAILURE_LIMIT = 3;

/**
 * 工具调用循环默认最大轮数
 * 可通过配置 maxToolLoopTurns 覆盖
 */
export const DEFAULT_MAX_TOOL_LOOP_TURNS = 4;

/**
 * 工具调用结果追踪截断长度（字符数）
 * 用于 traces 中 result 字段的长度限制
 */
export const TOOL_RESULT_TRACE_TRUNCATE_LENGTH = 1000;

// Re-export for backward compatibility
export { getMimeExtensionMap as MIME_EXTENSION_MAP } from "../../utils/mime-utils.js";
