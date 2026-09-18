/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean } from "../normalize.js";

export const TURN_EXECUTION_STATE = Object.freeze({
  SENDING: "sending",
  COMPLETED: "completed",
  USER_STOPPED: "user_stopped",
  ERROR: "error",
});

export const TURN_EXECUTION_STATE_VALUES = Object.freeze(Object.values(TURN_EXECUTION_STATE));

export function normalizeTurnExecutionState(value = "") {
  return clean(value).toLowerCase();
}

export function isTurnExecutionState(value = "") {
  return TURN_EXECUTION_STATE_VALUES.includes(normalizeTurnExecutionState(value));
}
