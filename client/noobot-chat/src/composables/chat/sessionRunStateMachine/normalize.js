/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_RUN_STATE, SESSION_RUN_TRANSITION_RULE, SESSION_RUN_TRANSITION_TABLE } from "./constants";

export function trim(value = "") {
  return String(value || "").trim();
}

export function normalizeState(state = "") {
  const value = trim(state).toLowerCase();
  if (value === "running") return SESSION_RUN_STATE.SENDING;
  if (value === "completed") return SESSION_RUN_STATE.BACKEND_COMPLETED;
  if (value === "cancelled") return SESSION_RUN_STATE.CANCELLED;
  return Object.values(SESSION_RUN_STATE).includes(value) ? value : "";
}

export function transitionPriority(state = "") {
  return SESSION_RUN_TRANSITION_TABLE[normalizeState(state)]?.priority ?? 0;
}

export function transitionRule(state = "") {
  return SESSION_RUN_TRANSITION_TABLE[normalizeState(state)]?.rule || SESSION_RUN_TRANSITION_RULE.PRIORITY_FORWARD;
}
