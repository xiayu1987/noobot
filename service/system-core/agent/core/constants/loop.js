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
  toolConsecutiveFailureHelpPrompt:
    "agent.toolConsecutiveFailureHelpPrompt",
  helpToolLoopPrompt: "agent.helpToolLoopPrompt",
  fetchGeneratedMediaFailed: "agent.fetchGeneratedMediaFailed",
  fetchRemoteMediaArtifactFailed: "agent.fetchRemoteMediaArtifactFailed",
  abortError: "agent.abortError",
  phaseSummaryPrompt: "agent.phaseSummaryPrompt",
};

/**
 * 工具连续错误触发帮助提示默认阈值
 */
export const DEFAULT_TOOL_FAILURE_HELP_COUNT = 3;

/**
 * 工具调用循环默认最大轮数
 * 可通过配置 maxToolLoopTurns 覆盖
 */
export const DEFAULT_MAX_TOOL_LOOP_TURNS = 4;

/**
 * 阶段小结默认触发工具循环轮数。
 * 0 表示默认不强制触发；可通过 tools.task_summary.phase_summary_loop_turns 覆盖。
 */
export const DEFAULT_PHASE_SUMMARY_LOOP_TURNS = 0;

/**
 * 帮助提示默认循环轮数
 */
export const DEFAULT_HELP_PROMPT_LOOP_TURNS = 50;

/**
 * Internal message type markers for system-injected prompts.
 */
export const PHASE_SUMMARY_PROMPT_MARKER = "noobot.phase_summary_prompt";
export const HELP_TOOL_LOOP_PROMPT_MARKER = "noobot.help_tool_loop_prompt";
export const HELP_TOOL_FAILURE_PROMPT_MARKER = "noobot.help_tool_failure_prompt";

/**
 * Tool names used internally by the engine.
 */
export const TASK_SUMMARY_TOOL_NAME = "task_summary";
