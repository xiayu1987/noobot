/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  assertMainFlowControlPort,
  createPhaseSummaryInstruction,
  createSummaryCheckpointInstruction,
  createSummarySchedulingClaim,
} from "@noobot/context-protocol/policy/main-flow-control";
import { isPlainObject } from "@noobot/shared/value";

export function createMainFlowControlState() {
  return {
    summaryCheckpoints: [],
    summarySchedulingOwner: null,
    phaseSummaryInstruction: null,
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

export function claimMainFlowSummaryScheduling(runtime, input) {
  const { source } = createSummarySchedulingClaim(input);
  const state = requireState(runtime);
  if (state.summarySchedulingOwner !== null && state.summarySchedulingOwner !== source) {
    throw new Error("summary scheduling already has an owner");
  }
  state.summarySchedulingOwner = source;
}

export function hasExternalSummaryScheduler(runtime) {
  return requireState(runtime).summarySchedulingOwner !== null;
}

export function requestMainFlowPhaseSummary(runtime, input) {
  const state = requireState(runtime);
  if (state.phaseSummaryInstruction) throw new Error("phase summary is already pending");
  state.phaseSummaryInstruction = createPhaseSummaryInstruction(input);
  return state.phaseSummaryInstruction;
}

export function peekMainFlowPhaseSummary(runtime) {
  return requireState(runtime).phaseSummaryInstruction;
}

export function acknowledgeMainFlowPhaseSummary(runtime, instruction) {
  const state = requireState(runtime);
  if (state.phaseSummaryInstruction !== instruction) {
    throw new Error("phase summary acknowledgement does not match pending instruction");
  }
  state.phaseSummaryInstruction = null;
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

export function markMainFlowFinalNoToolsTurnActive(runtime, active) {
  if (typeof active !== "boolean") {
    throw new TypeError("main flow final no-tools turn active flag must be boolean");
  }
  requireState(runtime).finalNoToolsTurnActive = active;
}

export function isMainFlowFinalNoToolsTurnEngaged(runtime) {
  return requireState(runtime).finalNoToolsTurnActive;
}

export function createMainFlowControlPort(runtime) {
  requireState(runtime);
  return assertMainFlowControlPort(
    Object.freeze({
      claimSummaryScheduling: (input) => claimMainFlowSummaryScheduling(runtime, input),
      requestPhaseSummary: (input) => requestMainFlowPhaseSummary(runtime, input),
      hasPendingSummary: () => {
        const state = requireState(runtime);
        return state.phaseSummaryInstruction !== null || state.summaryCheckpoints.length > 0;
      },
      requestSummaryCheckpoint: (input) => requestMainFlowSummaryCheckpoint(runtime, input),
      isFinalNoToolsTurnEngaged: () => isMainFlowFinalNoToolsTurnEngaged(runtime),
    }),
  );
}
