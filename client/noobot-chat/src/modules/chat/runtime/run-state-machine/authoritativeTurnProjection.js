/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFailedTurnState, TURN_STATE } from "@noobot/session-protocol";
import { FrontendRunState } from "./constants.js";

const AUTHORITY_TERMINAL_TO_FRONTEND_STATE = Object.freeze({
  [TURN_STATE.COMPLETED]: FrontendRunState.FRONTEND_COMPLETED,
  [TURN_STATE.STOP_COMPLETED]: FrontendRunState.USER_STOP_COMPLETED,
  [TURN_STATE.ACTION_FAILED]: FrontendRunState.ACTION_REQUEST_ERROR,
  [TURN_STATE.PROCESSING_FAILED]: FrontendRunState.PROCESSING_ERROR,
  [TURN_STATE.COMPLETION_FAILED]: FrontendRunState.COMPLETION_ERROR,
  [TURN_STATE.STOP_FAILED]: FrontendRunState.STOP_ERROR,
});

const AUTHORITY_TO_FRONTEND_STATE = Object.freeze({
  [TURN_STATE.ACTION_REQUESTING]: FrontendRunState.ACTION_REQUESTING,
  [TURN_STATE.PROCESSING]: FrontendRunState.PROCESSING,
  [TURN_STATE.COMPLETION_REQUESTING]: FrontendRunState.FRONTEND_COMPLETION_REQUESTING,
  [TURN_STATE.STOPPING]: FrontendRunState.USER_STOPPING,
  ...AUTHORITY_TERMINAL_TO_FRONTEND_STATE,
});

function normalizeAuthoritativeTurnState(state = "") {
  return String(state || "")
    .trim()
    .toLowerCase();
}

export function projectAuthoritativeTurnState(state = "") {
  return AUTHORITY_TO_FRONTEND_STATE[normalizeAuthoritativeTurnState(state)] || "";
}

export function projectAuthoritativeTerminalTurnState(state = "") {
  return AUTHORITY_TERMINAL_TO_FRONTEND_STATE[normalizeAuthoritativeTurnState(state)] || "";
}

export function projectAuthoritativeTurnTerminal(state = "") {
  const normalized = normalizeAuthoritativeTurnState(state);
  if (normalized === TURN_STATE.COMPLETED) return "completed";
  if (normalized === TURN_STATE.STOP_COMPLETED) return "user_stopped";
  if (isFailedTurnState(normalized)) return "error";
  return null;
}
