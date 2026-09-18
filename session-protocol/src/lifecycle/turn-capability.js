/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isSettledTurn, TURN_STATE } from "./turn-state.js";
import { TURN_EXECUTION_STATE, normalizeTurnExecutionState } from "./turn-execution-state.js";

export function deriveAuthoritativeTurnCapabilities(turn = {}) {
  const state = String(turn?.state || "").trim();
  const executionState = normalizeTurnExecutionState(turn?.executionState);
  return Object.freeze({
    actionLocked: Boolean(state) && !isSettledTurn(turn),
    canStop: state === TURN_STATE.PROCESSING && executionState === TURN_EXECUTION_STATE.SENDING,
  });
}
