/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  FRONTEND_STATE_TURN_TERMINAL,
  TURN_RUNTIME_TERMINAL,
  TURN_TERMINAL_NOTICE_LABEL_KEY,
} from "./constants.js";
import { normalizeState } from "./normalize.js";

export function resolveTurnRuntimeTerminal(state = "") {
  return FRONTEND_STATE_TURN_TERMINAL[normalizeState(state)] || "";
}

export function isTurnRuntimeTerminal(value = "") {
  return Object.values(TURN_RUNTIME_TERMINAL).includes(normalizeState(value));
}

export function resolveTurnTerminalNoticeLabelKey(value = "") {
  return TURN_TERMINAL_NOTICE_LABEL_KEY[normalizeState(value)] || "";
}

export function isTurnTerminalNotice(value = "") {
  return Boolean(resolveTurnTerminalNoticeLabelKey(value));
}

export { TURN_RUNTIME_TERMINAL };
