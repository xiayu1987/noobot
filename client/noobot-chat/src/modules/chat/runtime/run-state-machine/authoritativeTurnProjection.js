/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_STATE } from "@noobot/event-protocol";
import { FrontendRunState } from "./constants.js";

const AUTHORITY_TO_FRONTEND_STATE = Object.freeze({
  [TURN_STATE.ACTION_REQUESTING]: FrontendRunState.ACTION_REQUESTING,
  [TURN_STATE.PROCESSING]: FrontendRunState.PROCESSING,
  [TURN_STATE.COMPLETION_REQUESTING]: FrontendRunState.FRONTEND_COMPLETION_REQUESTING,
  [TURN_STATE.COMPLETED]: FrontendRunState.FRONTEND_COMPLETED,
  [TURN_STATE.STOPPING]: FrontendRunState.USER_STOPPING,
  [TURN_STATE.STOP_COMPLETED]: FrontendRunState.USER_STOP_COMPLETED,
  [TURN_STATE.ACTION_FAILED]: FrontendRunState.ACTION_REQUEST_ERROR,
  [TURN_STATE.PROCESSING_FAILED]: FrontendRunState.PROCESSING_ERROR,
  [TURN_STATE.COMPLETION_FAILED]: FrontendRunState.COMPLETION_ERROR,
  [TURN_STATE.STOP_FAILED]: FrontendRunState.STOP_ERROR,
});

export function projectAuthoritativeTurnState(state = "") {
  return AUTHORITY_TO_FRONTEND_STATE[String(state || "").trim().toLowerCase()] || "";
}

export function projectAuthoritativeTurnTerminal(state = "") {
  const normalized = String(state || "").trim().toLowerCase();
  if (normalized === TURN_STATE.COMPLETED) return "completed";
  if (normalized === TURN_STATE.STOP_COMPLETED) return "user_stopped";
  if ([
    TURN_STATE.ACTION_FAILED,
    TURN_STATE.PROCESSING_FAILED,
    TURN_STATE.COMPLETION_FAILED,
    TURN_STATE.STOP_FAILED,
  ].includes(normalized)) return "error";
  return null;
}
