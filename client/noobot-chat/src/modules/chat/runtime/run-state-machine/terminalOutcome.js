/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MESSAGE_TERMINAL_OUTCOME,
  MESSAGE_TERMINAL_OUTCOME_PRECEDENCE,
  MESSAGE_TERMINAL_STATE_OUTCOME,
} from "./constants.js";
import { normalizeState } from "./normalize.js";

export function normalizeTerminalOutcome(outcome = "") {
  const normalizedOutcome = String(outcome || "").trim().toLowerCase();
  return MESSAGE_TERMINAL_OUTCOME_PRECEDENCE[normalizedOutcome] ? normalizedOutcome : "";
}

export function isTerminalOutcome(outcome = "") {
  return Boolean(normalizeTerminalOutcome(outcome));
}

export function resolveTerminalOutcome(currentOutcome = "", nextOutcome = "") {
  const normalizedCurrent = normalizeTerminalOutcome(currentOutcome);
  const normalizedNext = normalizeTerminalOutcome(nextOutcome);
  if (!normalizedNext) return normalizedCurrent;
  if (!normalizedCurrent) return normalizedNext;
  return MESSAGE_TERMINAL_OUTCOME_PRECEDENCE[normalizedNext] >
    MESSAGE_TERMINAL_OUTCOME_PRECEDENCE[normalizedCurrent]
    ? normalizedNext
    : normalizedCurrent;
}

export function resolveStateTerminalOutcome(state = "") {
  return MESSAGE_TERMINAL_STATE_OUTCOME[normalizeState(state)] || "";
}

export function isTerminalRunState(state = "") {
  return Boolean(resolveStateTerminalOutcome(state));
}

export { MESSAGE_TERMINAL_OUTCOME };
