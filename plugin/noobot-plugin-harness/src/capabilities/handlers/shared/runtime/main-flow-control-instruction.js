/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const HARNESS_MAIN_FLOW_CONTROL_ACTION = Object.freeze({
  FINAL_NO_TOOLS_TURN: "final_no_tools_turn",
  SUMMARY_CHECKPOINT: "summary_checkpoint",
});

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function resolveAgentRuntimeFromHookContext(ctx = {}) {
  const agentContext = asObject(ctx?.agentContext);
  if (!agentContext) return null;
  return asObject(agentContext?.bindings?.runtime);
}

function resolveAgentSystemRuntimeFromHookContext(ctx = {}) {
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

export function requestSummaryCheckpointMainFlowInstruction(
  ctx = {},
  { source = "plugin.summary", summarizedMessageIds = [] } = {},
) {
  const runtime = resolveAgentRuntimeFromHookContext(ctx);
  if (!runtime) return null;
  if (!asObject(runtime.systemRuntime)) runtime.systemRuntime = {};
  const canonicalMessageIds = [...new Set(
    (Array.isArray(summarizedMessageIds) ? summarizedMessageIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  )];
  if (!canonicalMessageIds.length) return null;
  const instruction = {
    action: HARNESS_MAIN_FLOW_CONTROL_ACTION.SUMMARY_CHECKPOINT,
    source: String(source || "plugin.summary").trim(),
    summarizedMessageIds: canonicalMessageIds,
  };
  const pending = Array.isArray(runtime.systemRuntime.mainFlowControlInstructions)
    ? runtime.systemRuntime.mainFlowControlInstructions
    : [];
  pending.push(instruction);
  runtime.systemRuntime.mainFlowControlInstructions = pending;
  return instruction;
}
