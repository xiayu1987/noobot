/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MAIN_FLOW_CONTROL_ACTION = Object.freeze({
  FINAL_NO_TOOLS_TURN: "final_no_tools_turn",
});

export const MAIN_FLOW_CONTROL_REASON = Object.freeze({
  CONTEXT_OVERFLOW_AFTER_SUMMARY: "context_overflow_after_summary",
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
  const instruction = normalizeFinalNoToolsInstruction(systemRuntime.mainFlowControlInstruction);
  if (instruction) return instruction;
  if (systemRuntime.phaseSummaryNoToolsNextTurn === true) {
    return {
      action: MAIN_FLOW_CONTROL_ACTION.FINAL_NO_TOOLS_TURN,
      reason: MAIN_FLOW_CONTROL_REASON.CONTEXT_OVERFLOW_AFTER_SUMMARY,
      source: "phase_summary_legacy_flag",
      requestedAt: "",
      detail: {},
    };
  }
  return null;
}

export function clearMainFlowFinalNoToolsTurnInstruction(runtimeOrSystemRuntime = {}) {
  const systemRuntime = resolveSystemRuntimeHolder(runtimeOrSystemRuntime);
  if (!systemRuntime) return false;
  let changed = false;
  if (normalizeFinalNoToolsInstruction(systemRuntime.mainFlowControlInstruction)) {
    delete systemRuntime.mainFlowControlInstruction;
    changed = true;
  }
  if (systemRuntime.phaseSummaryNoToolsNextTurn === true) {
    systemRuntime.phaseSummaryNoToolsNextTurn = false;
    changed = true;
  }
  return changed;
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
