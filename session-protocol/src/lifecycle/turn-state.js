/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TURN_PHASE = Object.freeze({
  ACTION: "action",
  PROCESSING: "processing",
  COMPLETION: "completion",
  STOP: "stop",
});

export const TURN_STATE = Object.freeze({
  ACTION_REQUESTING: "action_requesting",
  PROCESSING: "processing",
  COMPLETION_REQUESTING: "completion_requesting",
  COMPLETED: "completed",
  STOPPING: "stopping",
  STOP_COMPLETED: "stop_completed",
  ACTION_FAILED: "action_failed",
  PROCESSING_FAILED: "processing_failed",
  COMPLETION_FAILED: "completion_failed",
  STOP_FAILED: "stop_failed",
});

export const TURN_TERMINAL_STATES = Object.freeze([
  TURN_STATE.COMPLETED,
  TURN_STATE.STOP_COMPLETED,
  TURN_STATE.ACTION_FAILED,
  TURN_STATE.PROCESSING_FAILED,
  TURN_STATE.COMPLETION_FAILED,
  TURN_STATE.STOP_FAILED,
]);

export const TURN_FINALIZE_FAILURE_STATES = Object.freeze([
  TURN_STATE.COMPLETION_FAILED,
  TURN_STATE.STOP_FAILED,
]);

const terminalStates = new Set(TURN_TERMINAL_STATES);
const finalizeFailureStates = new Set(TURN_FINALIZE_FAILURE_STATES);

export function isTerminalTurnState(state = "") {
  return terminalStates.has(String(state || "").trim());
}

export function isRetryableFinalizeFailure(turn = {}) {
  return finalizeFailureStates.has(String(turn?.state || "").trim()) &&
    turn?.finalizeIntent?.retryable === true;
}

export function isSettledTurn(turn = {}) {
  return isTerminalTurnState(turn?.state) && !isRetryableFinalizeFailure(turn);
}
