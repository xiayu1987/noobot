/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  BackendChannelState,
  FrontendRunState,
  SESSION_RUN_TRANSITION_RULE,
  SESSION_RUN_TRANSITION_TABLE,
} from "./constants";

export function trim(value = "") {
  return String(value || "").trim();
}

export function normalizeState(state = "") {
  const value = trim(state).toLowerCase();
  if (value === "running") return BackendChannelState.SENDING;
  if (value === "completed") return BackendChannelState.COMPLETED;
  if (value === "cancelled") return FrontendRunState.CANCELLED;
  return [
    ...Object.values(BackendChannelState),
    ...Object.values(FrontendRunState),
  ].includes(value) ? value : "";
}

export function transitionPriority(state = "") {
  return SESSION_RUN_TRANSITION_TABLE[normalizeState(state)]?.priority ?? 0;
}

export function transitionRule(state = "") {
  return SESSION_RUN_TRANSITION_TABLE[normalizeState(state)]?.rule || SESSION_RUN_TRANSITION_RULE.PRIORITY_FORWARD;
}
