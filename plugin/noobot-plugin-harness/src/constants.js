/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const PLUGIN_NAME = "noobot-plugin-harness";
export const PLUGIN_VERSION = "0.1.0";

export const HARNESS_HOOK_POINTS = Object.freeze({
  BEFORE_CONTEXT_BUILD: "before_context_build",
  AFTER_CONTEXT_BUILD: "after_context_build",
  CONTEXT_BUILD_ERROR: "context_build_error",
  BEFORE_TURN: "before_turn",
  BEFORE_FINAL_OUTPUT: "before_final_output",
  AFTER_TURN: "after_turn",
  ON_ABORT: "on_abort",
  ON_ERROR: "on_error",
  BEFORE_LLM_CALL: "before_llm_call",
  AFTER_LLM_CALL: "after_llm_call",
  LLM_CALL_ERROR: "llm_call_error",
  BEFORE_TOOL_CALLS: "before_tool_calls",
  BEFORE_TOOL_CALL: "before_tool_call",
  AFTER_TOOL_CALL: "after_tool_call",
  TOOL_CALL_ERROR: "tool_call_error",
  BEFORE_STATE_COMMIT: "before_state_commit",
  AFTER_STATE_COMMIT: "after_state_commit",
  AFTER_SESSION_DELETE: "after_session_delete",
});
