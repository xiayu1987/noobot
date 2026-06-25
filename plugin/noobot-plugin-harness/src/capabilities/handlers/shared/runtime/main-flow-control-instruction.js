/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const HARNESS_MAIN_FLOW_CONTROL_ACTION = Object.freeze({
  FINAL_NO_TOOLS_TURN: "final_no_tools_turn",
});

export const HARNESS_MAIN_FLOW_CONTROL_REASON = Object.freeze({
  CONTEXT_OVERFLOW_AFTER_SUMMARY: "context_overflow_after_summary",
});

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function resolveAgentRuntimeFromHookContext(ctx = {}) {
  const agentContext = asObject(ctx?.agentContext);
  if (!agentContext) return null;
  return (
    asObject(agentContext?.execution?.controllers?.runtime) ||
    asObject(agentContext?.runtime) ||
    null
  );
}

export function resolveAgentSystemRuntimeFromHookContext(ctx = {}) {
  const runtime = resolveAgentRuntimeFromHookContext(ctx);
  return asObject(runtime?.systemRuntime) || null;
}

export function hasFinalNoToolsMainFlowInstruction(ctx = {}) {
  const systemRuntime = resolveAgentSystemRuntimeFromHookContext(ctx);
  if (!systemRuntime) return false;
  return (
    systemRuntime.mainFlowFinalNoToolsTurnActive === true ||
    String(systemRuntime.mainFlowControlInstruction?.action || "").trim() ===
      HARNESS_MAIN_FLOW_CONTROL_ACTION.FINAL_NO_TOOLS_TURN
  );
}

export function requestFinalNoToolsMainFlowInstruction(
  ctx = {},
  {
    reason = HARNESS_MAIN_FLOW_CONTROL_REASON.CONTEXT_OVERFLOW_AFTER_SUMMARY,
    source = "harness",
    detail = {},
  } = {},
) {
  const runtime = resolveAgentRuntimeFromHookContext(ctx);
  if (!runtime) return null;
  if (!asObject(runtime.systemRuntime)) runtime.systemRuntime = {};
  if (runtime.systemRuntime.mainFlowFinalNoToolsTurnActive === true) {
    return null;
  }
  const instruction = {
    action: HARNESS_MAIN_FLOW_CONTROL_ACTION.FINAL_NO_TOOLS_TURN,
    reason: String(reason || HARNESS_MAIN_FLOW_CONTROL_REASON.CONTEXT_OVERFLOW_AFTER_SUMMARY).trim(),
    source: String(source || "harness").trim(),
    requestedAt: new Date().toISOString(),
    detail: asObject(detail) || {},
  };
  runtime.systemRuntime.mainFlowControlInstruction = instruction;
  return instruction;
}
