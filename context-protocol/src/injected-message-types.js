/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const CONTEXT_INJECTED_MESSAGE_TYPE = Object.freeze({
  PHASE_SUMMARY_PROMPT: "noobot.phase_summary_prompt",
  TASK_CHECK_PROMPT: "noobot.task_check_prompt",
  HELP_TOOL_LOOP_PROMPT: "noobot.help_tool_loop_prompt",
  HELP_TOOL_FAILURE_PROMPT: "noobot.help_tool_failure_prompt",
  TOOL_LOOP_LIMIT_FINALIZE_PROMPT: "tool_loop_limit_finalize_prompt",
  TASK_SUMMARY_SINGLE_TOOL_RETRY_PROMPT: "task_summary_single_tool_retry_prompt",
});

export const SUMMARY_CHECKPOINT_CONTROL_MESSAGE_TYPES = Object.freeze([
  ...Object.values(CONTEXT_INJECTED_MESSAGE_TYPE),
]);
