/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HOOK_POINT } from "@noobot/hook-protocol";

export const CAPABILITY_HOOK_MAP = Object.freeze({
  planning: [
    HOOK_POINT.AGENT.BEFORE_CONTEXT_BUILD,
    HOOK_POINT.AGENT.BEFORE_TURN,
    HOOK_POINT.AGENT.BEFORE_LLM_CALL,
    HOOK_POINT.AGENT.AFTER_LLM_CALL,
    HOOK_POINT.AGENT.AFTER_TOOL_CALLS,
    HOOK_POINT.AGENT.BEFORE_FINAL_OUTPUT,
  ],
  guidance: [
    HOOK_POINT.AGENT.BEFORE_LLM_CALL,
    HOOK_POINT.AGENT.AFTER_LLM_CALL,
    HOOK_POINT.AGENT.AFTER_TOOL_CALLS,
    HOOK_POINT.AGENT.AFTER_TOOL_CALL,
    HOOK_POINT.AGENT.TOOL_CALL_ERROR,
    HOOK_POINT.AGENT.BEFORE_FINAL_OUTPUT,
  ],
  acceptance: [
    HOOK_POINT.AGENT.BEFORE_TURN,
    HOOK_POINT.AGENT.BEFORE_TOOL_CALLS,
    HOOK_POINT.AGENT.BEFORE_TOOL_CALL,
    HOOK_POINT.AGENT.BEFORE_FINAL_OUTPUT,
    HOOK_POINT.AGENT.BEFORE_LLM_CALL,
    HOOK_POINT.AGENT.AFTER_LLM_CALL,
  ],
  review: [
    HOOK_POINT.AGENT.BEFORE_FINAL_OUTPUT,
    HOOK_POINT.AGENT.AFTER_TURN,
    HOOK_POINT.AGENT.ON_ERROR,
    HOOK_POINT.AGENT.ON_ABORT,
    HOOK_POINT.AGENT.CONTEXT_BUILD_ERROR,
    HOOK_POINT.AGENT.LLM_CALL_ERROR,
    HOOK_POINT.AGENT.TOOL_CALL_ERROR,
  ],
});

export function resolveCapabilitiesForHook(point = "") {
  const hook = String(point || "").trim();
  if (!hook) return [];
  return Object.entries(CAPABILITY_HOOK_MAP)
    .filter(([, hooks]) => Array.isArray(hooks) && hooks.includes(hook))
    .map(([capability]) => capability);
}
