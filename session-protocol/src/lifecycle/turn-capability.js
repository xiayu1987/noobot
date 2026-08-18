/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isSettledTurn, TURN_STATE } from "./turn-state.js";

export function deriveAuthoritativeTurnCapabilities(turn = {}) {
  const state = String(turn?.state || "").trim();
  const executionState = String(turn?.executionState || "")
    .trim()
    .toLowerCase();
  return Object.freeze({
    actionLocked: Boolean(state) && !isSettledTurn(turn),
    canStop: state === TURN_STATE.PROCESSING && executionState === "sending",
  });
}
