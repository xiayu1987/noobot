/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject, text } from "@noobot/shared/value";

const MAIN_FLOW_CONTROL_ACTION = Object.freeze({
  FINAL_NO_TOOLS_TURN: "final_no_tools_turn",
  SUMMARY_CHECKPOINT: "summary_checkpoint",
});

export const MAIN_FLOW_CONTROL_REASON = Object.freeze({
  CONTEXT_OVERFLOW_AFTER_SUMMARY: "context_overflow_after_summary",
  TASK_SUMMARY_COMPLETE: "task_summary_complete",
  TASK_SUMMARY_BLOCKED: "task_summary_blocked",
});

function asObject(value) {
  return isPlainObject(value) ? value : null;
}

function requireSystemRuntime(runtime) {
  const systemRuntime = asObject(runtime?.systemRuntime);
  if (!systemRuntime) {
    throw new TypeError(
      "main flow control requires runtime.systemRuntime from createRuntimeContext",
    );
  }
  return systemRuntime;
}

function normalizeFinalNoToolsInstruction(instruction = null) {
  const value = asObject(instruction);
  if (!value) return null;
  const action = text(value.action);
  if (action !== MAIN_FLOW_CONTROL_ACTION.FINAL_NO_TOOLS_TURN) return null;
  return {
    action,
    reason: text(value.reason) || MAIN_FLOW_CONTROL_REASON.CONTEXT_OVERFLOW_AFTER_SUMMARY,
    source: text(value.source),
    requestedAt: text(value.requestedAt),
    detail: asObject(value.detail) || {},
  };
}

function normalizeSummaryCheckpointInstruction(instruction = null) {
  const value = asObject(instruction);
  if (!value || text(value.action) !== MAIN_FLOW_CONTROL_ACTION.SUMMARY_CHECKPOINT) {
    return null;
  }
  return {
    action: MAIN_FLOW_CONTROL_ACTION.SUMMARY_CHECKPOINT,
    source: text(value.source),
    summarizedMessageIds: (Array.isArray(value.summarizedMessageIds)
      ? value.summarizedMessageIds
      : []
    )
      .map((id) => text(id))
      .filter(Boolean),
  };
}

export function requestMainFlowSummaryCheckpoint(
  runtime,
  { source = "", summarizedMessageIds = [] } = {},
) {
  const systemRuntime = requireSystemRuntime(runtime);
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

export function peekMainFlowSummaryCheckpoint(runtime) {
  const systemRuntime = requireSystemRuntime(runtime);
  const pending = Array.isArray(systemRuntime.mainFlowControlInstructions)
    ? systemRuntime.mainFlowControlInstructions
    : [];
  const pendingIndex = pending.findIndex((item) => normalizeSummaryCheckpointInstruction(item));
  const instruction =
    pendingIndex >= 0
      ? normalizeSummaryCheckpointInstruction(pending[pendingIndex])
      : normalizeSummaryCheckpointInstruction(systemRuntime.mainFlowControlInstruction);
  return instruction;
}

export function acknowledgeMainFlowSummaryCheckpoint(runtime) {
  const systemRuntime = requireSystemRuntime(runtime);
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
  runtime,
  {
    reason = MAIN_FLOW_CONTROL_REASON.CONTEXT_OVERFLOW_AFTER_SUMMARY,
    source = "agent",
    detail = {},
  } = {},
) {
  const systemRuntime = requireSystemRuntime(runtime);
  const instruction = {
    action: MAIN_FLOW_CONTROL_ACTION.FINAL_NO_TOOLS_TURN,
    reason: text(reason) || MAIN_FLOW_CONTROL_REASON.CONTEXT_OVERFLOW_AFTER_SUMMARY,
    source: text(source),
    requestedAt: new Date().toISOString(),
    detail: asObject(detail) || {},
  };
  systemRuntime.mainFlowControlInstruction = instruction;
  return instruction;
}

export function peekMainFlowFinalNoToolsTurnInstruction(runtime) {
  const systemRuntime = requireSystemRuntime(runtime);
  return normalizeFinalNoToolsInstruction(systemRuntime.mainFlowControlInstruction);
}

export function clearMainFlowFinalNoToolsTurnInstruction(runtime) {
  const systemRuntime = requireSystemRuntime(runtime);
  if (normalizeFinalNoToolsInstruction(systemRuntime.mainFlowControlInstruction)) {
    delete systemRuntime.mainFlowControlInstruction;
    return true;
  }
  return false;
}

export function consumeMainFlowFinalNoToolsTurnInstruction(runtime) {
  const instruction = peekMainFlowFinalNoToolsTurnInstruction(runtime);
  if (!instruction) return null;
  clearMainFlowFinalNoToolsTurnInstruction(runtime);
  return instruction;
}

export function markMainFlowFinalNoToolsTurnActive(runtime, active = true) {
  const systemRuntime = requireSystemRuntime(runtime);
  systemRuntime.mainFlowFinalNoToolsTurnActive = active === true;
  return true;
}
