/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  assertMainFlowControlPort,
  createFinalNoToolsTurnInstruction,
  createSummaryCheckpointInstruction,
} from "@noobot/context-protocol/policy/main-flow-control";
import { isPlainObject } from "@noobot/shared/value";

export function createMainFlowControlState() {
  return {
    summaryCheckpoints: [],
    finalNoToolsInstruction: null,
    finalNoToolsTurnActive: false,
  };
}

function requireState(runtime) {
  const state = runtime?.mainFlowControlState;
  if (!isPlainObject(state) || !Array.isArray(state.summaryCheckpoints)) {
    throw new TypeError(
      "main flow control requires runtime.mainFlowControlState from createRuntimeContext",
    );
  }
  return state;
}

export function requestMainFlowSummaryCheckpoint(runtime, input) {
  const state = requireState(runtime);
  const instruction = createSummaryCheckpointInstruction(input);
  state.summaryCheckpoints.push(instruction);
  return instruction;
}

export function peekMainFlowSummaryCheckpoint(runtime) {
  return requireState(runtime).summaryCheckpoints[0] || null;
}

export function acknowledgeMainFlowSummaryCheckpoint(runtime) {
  const state = requireState(runtime);
  if (!state.summaryCheckpoints.length) return false;
  state.summaryCheckpoints.shift();
  return true;
}

export function requestMainFlowFinalNoToolsTurn(runtime, input) {
  const state = requireState(runtime);
  state.finalNoToolsInstruction = createFinalNoToolsTurnInstruction(input);
  return state.finalNoToolsInstruction;
}

export function peekMainFlowFinalNoToolsTurnInstruction(runtime) {
  return requireState(runtime).finalNoToolsInstruction;
}

export function clearMainFlowFinalNoToolsTurnInstruction(runtime) {
  const state = requireState(runtime);
  const cleared = state.finalNoToolsInstruction !== null;
  state.finalNoToolsInstruction = null;
  return cleared;
}

export function consumeMainFlowFinalNoToolsTurnInstruction(runtime) {
  const instruction = peekMainFlowFinalNoToolsTurnInstruction(runtime);
  clearMainFlowFinalNoToolsTurnInstruction(runtime);
  return instruction;
}

export function markMainFlowFinalNoToolsTurnActive(runtime, active) {
  if (typeof active !== "boolean") {
    throw new TypeError("main flow final no-tools turn active flag must be boolean");
  }
  requireState(runtime).finalNoToolsTurnActive = active;
}

export function isMainFlowFinalNoToolsTurnEngaged(runtime) {
  const state = requireState(runtime);
  return state.finalNoToolsTurnActive || state.finalNoToolsInstruction !== null;
}

export function createMainFlowControlPort(runtime) {
  requireState(runtime);
  return assertMainFlowControlPort(
    Object.freeze({
      requestSummaryCheckpoint: (input) => requestMainFlowSummaryCheckpoint(runtime, input),
      isFinalNoToolsTurnEngaged: () => isMainFlowFinalNoToolsTurnEngaged(runtime),
    }),
  );
}
