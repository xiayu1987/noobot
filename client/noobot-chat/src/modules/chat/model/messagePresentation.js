/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isTerminalStatusStepState,
  normalizeStatusStepState,
  resolveTurnTerminalStatusStep,
} from "../runtime/sessionRunStateMachine.js";

function text(value = "") {
  return String(value || "").trim();
}

export function normalizeStatusStepDisplayState(value = "") {
  return normalizeStatusStepState(value);
}

export function resolveStatusStepPresentation({
  turnRuntime = null,
  runtimeDisplayState = "",
  projectedState = "",
} = {}) {
  const projectedDisplayState = normalizeStatusStepDisplayState(projectedState);
  if (turnRuntime) {
    const terminalDisplayState = resolveTurnTerminalStatusStep(turnRuntime.terminal);
    if (terminalDisplayState) {
      return { displayState: terminalDisplayState, source: "turn-runtime-terminal" };
    }
    const runtimeState = normalizeStatusStepDisplayState(runtimeDisplayState);
    if (runtimeState && !isTerminalStatusStepState(runtimeState)) {
      return { displayState: runtimeState, source: "turn-runtime-active" };
    }
    return projectedDisplayState
      ? { displayState: projectedDisplayState, source: "child-execution-projection" }
      : { displayState: "", source: "" };
  }
  if (projectedDisplayState) {
    return { displayState: projectedDisplayState, source: "child-execution-projection" };
  }
  return { displayState: "", source: "" };
}

function mergeProjectedStatusStepState(previousState = "", currentState = "") {
  const previous = normalizeStatusStepDisplayState(previousState);
  const current = normalizeStatusStepDisplayState(currentState);
  if (!current) return previous;
  if (!previous) return current;
  if (isTerminalStatusStepState(previous) && !isTerminalStatusStepState(current)) {
    return previous;
  }
  return current;
}


export function mergeMessagePresentationFacets(previousMessage = {}, currentMessage = {}) {
  const previousScopeId = text(previousMessage?.statusTurnScopeId);
  const currentScopeId = text(currentMessage?.statusTurnScopeId);
  if (previousScopeId && currentScopeId && previousScopeId !== currentScopeId) {
    return {
      statusTurnScopeId: previousScopeId,
      projectedStatusStepState: normalizeStatusStepDisplayState(
        previousMessage?.projectedStatusStepState,
      ),
    };
  }
  return {
    statusTurnScopeId: previousScopeId || currentScopeId,
    projectedStatusStepState: mergeProjectedStatusStepState(
      previousMessage?.projectedStatusStepState,
      currentMessage?.projectedStatusStepState,
    ),
  };
}
