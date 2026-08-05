/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MAIN_FLOW_CONTROL_ACTION = Object.freeze({
  FINAL_NO_TOOLS_TURN: "final_no_tools_turn",
  SUMMARY_CHECKPOINT: "summary_checkpoint",
});

export const MAIN_FLOW_CONTROL_REASON = Object.freeze({
  CONTEXT_OVERFLOW_AFTER_SUMMARY: "context_overflow_after_summary",
  TASK_SUMMARY_COMPLETE: "task_summary_complete",
  TASK_SUMMARY_BLOCKED: "task_summary_blocked",
});

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function resolveSystemRuntimeHolder(runtimeOrSystemRuntime = {}) {
  const input = asObject(runtimeOrSystemRuntime);
  if (!input) return null;
  if (asObject(input.systemRuntime)) return input.systemRuntime;
  return input;
}

function ensureSystemRuntime(runtime = {}) {
  const holder = asObject(runtime);
  if (!holder) return null;
  if (!asObject(holder.systemRuntime)) holder.systemRuntime = {};
  return holder.systemRuntime;
}

function normalizeFinalNoToolsInstruction(instruction = null) {
  const value = asObject(instruction);
  if (!value) return null;
  const action = String(value.action || "").trim();
  if (action !== MAIN_FLOW_CONTROL_ACTION.FINAL_NO_TOOLS_TURN) return null;
  return {
    action,
    reason: String(value.reason || MAIN_FLOW_CONTROL_REASON.CONTEXT_OVERFLOW_AFTER_SUMMARY).trim(),
    source: String(value.source || "").trim(),
    requestedAt: String(value.requestedAt || "").trim(),
    detail: asObject(value.detail) || {},
  };
}

function normalizeSummaryCheckpointInstruction(instruction = null) {
  const value = asObject(instruction);
  if (!value || String(value.action || "").trim() !== MAIN_FLOW_CONTROL_ACTION.SUMMARY_CHECKPOINT) {
    return null;
  }
  return {
    action: MAIN_FLOW_CONTROL_ACTION.SUMMARY_CHECKPOINT,
    source: String(value.source || "").trim(),
    summarizedMessageIds: (Array.isArray(value.summarizedMessageIds)
      ? value.summarizedMessageIds
      : []).map((id) => String(id || "").trim()).filter(Boolean),
  };
}

export function requestMainFlowSummaryCheckpoint(
  runtime = {},
  { source = "", summarizedMessageIds = [] } = {},
) {
  const systemRuntime = ensureSystemRuntime(runtime);
  if (!systemRuntime) return null;
  const instruction = normalizeSummaryCheckpointInstruction({
    action: MAIN_FLOW_CONTROL_ACTION.SUMMARY_CHECKPOINT,
    source,
    summarizedMessageIds,
  });
  if (!instruction.summarizedMessageIds.length) return null;
  const pending = Array.isArray(systemRuntime.mainFlowControlInstructions)
    ? systemRuntime.mainFlowControlInstructions
    : [];
  pending.push(instruction);
  systemRuntime.mainFlowControlInstructions = pending;
  return instruction;
}

export function peekMainFlowSummaryCheckpoint(runtimeOrSystemRuntime = {}) {
  const systemRuntime = resolveSystemRuntimeHolder(runtimeOrSystemRuntime);
  if (!systemRuntime) return null;
  const pending = Array.isArray(systemRuntime.mainFlowControlInstructions)
    ? systemRuntime.mainFlowControlInstructions
    : [];
  const pendingIndex = pending.findIndex((item) => normalizeSummaryCheckpointInstruction(item));
  const instruction = pendingIndex >= 0
    ? normalizeSummaryCheckpointInstruction(pending[pendingIndex])
    : normalizeSummaryCheckpointInstruction(systemRuntime.mainFlowControlInstruction);
  return instruction;
}

export function acknowledgeMainFlowSummaryCheckpoint(runtimeOrSystemRuntime = {}) {
  const systemRuntime = resolveSystemRuntimeHolder(runtimeOrSystemRuntime);
  if (!systemRuntime) return false;
  const pending = Array.isArray(systemRuntime.mainFlowControlInstructions)
    ? systemRuntime.mainFlowControlInstructions
    : [];
  const pendingIndex = pending.findIndex((item) => normalizeSummaryCheckpointInstruction(item));
  if (pendingIndex < 0) return false;
  if (pendingIndex >= 0) pending.splice(pendingIndex, 1);
  if (pending.length) systemRuntime.mainFlowControlInstructions = pending;
  else delete systemRuntime.mainFlowControlInstructions;
  return true;
}

export function requestMainFlowFinalNoToolsTurn(
  runtime = {},
  {
    reason = MAIN_FLOW_CONTROL_REASON.CONTEXT_OVERFLOW_AFTER_SUMMARY,
    source = "agent",
    detail = {},
  } = {},
) {
  const systemRuntime = ensureSystemRuntime(runtime);
  if (!systemRuntime) return null;
  const instruction = {
    action: MAIN_FLOW_CONTROL_ACTION.FINAL_NO_TOOLS_TURN,
    reason: String(reason || MAIN_FLOW_CONTROL_REASON.CONTEXT_OVERFLOW_AFTER_SUMMARY).trim(),
    source: String(source || "").trim(),
    requestedAt: new Date().toISOString(),
    detail: asObject(detail) || {},
  };
  systemRuntime.mainFlowControlInstruction = instruction;
  return instruction;
}

export function peekMainFlowFinalNoToolsTurnInstruction(runtimeOrSystemRuntime = {}) {
  const systemRuntime = resolveSystemRuntimeHolder(runtimeOrSystemRuntime);
  if (!systemRuntime) return null;
  return normalizeFinalNoToolsInstruction(systemRuntime.mainFlowControlInstruction);
}

export function clearMainFlowFinalNoToolsTurnInstruction(runtimeOrSystemRuntime = {}) {
  const systemRuntime = resolveSystemRuntimeHolder(runtimeOrSystemRuntime);
  if (!systemRuntime) return false;
  if (normalizeFinalNoToolsInstruction(systemRuntime.mainFlowControlInstruction)) {
    delete systemRuntime.mainFlowControlInstruction;
    return true;
  }
  return false;
}

export function consumeMainFlowFinalNoToolsTurnInstruction(runtimeOrSystemRuntime = {}) {
  const instruction = peekMainFlowFinalNoToolsTurnInstruction(runtimeOrSystemRuntime);
  if (!instruction) return null;
  clearMainFlowFinalNoToolsTurnInstruction(runtimeOrSystemRuntime);
  return instruction;
}

export function markMainFlowFinalNoToolsTurnActive(runtimeOrSystemRuntime = {}, active = true) {
  const systemRuntime = resolveSystemRuntimeHolder(runtimeOrSystemRuntime);
  if (!systemRuntime) return false;
  systemRuntime.mainFlowFinalNoToolsTurnActive = active === true;
  return true;
}

export function isMainFlowFinalNoToolsTurnActive(runtimeOrSystemRuntime = {}) {
  const systemRuntime = resolveSystemRuntimeHolder(runtimeOrSystemRuntime);
  return systemRuntime?.mainFlowFinalNoToolsTurnActive === true;
}
