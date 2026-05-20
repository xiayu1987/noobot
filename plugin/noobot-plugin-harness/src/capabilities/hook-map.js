/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const CAPABILITY_HOOK_MAP = Object.freeze({
  planning: ["before_context_build", "before_turn", "before_llm_call", "after_llm_call", "before_final_output"],
  guidance: [
    "before_llm_call",
    "after_tool_call",
    "tool_call_error",
    "before_final_output",
  ],
  acceptance: ["before_turn", "before_tool_calls", "before_tool_call", "before_final_output"],
  review: [
    "before_final_output",
    "after_turn",
    "on_error",
    "on_abort",
    "context_build_error",
    "llm_call_error",
    "tool_call_error",
  ],
});

export function resolveCapabilitiesForHook(point = "") {
  const hook = String(point || "").trim();
  if (!hook) return [];
  return Object.entries(CAPABILITY_HOOK_MAP)
    .filter(([, hooks]) => Array.isArray(hooks) && hooks.includes(hook))
    .map(([capability]) => capability);
}
