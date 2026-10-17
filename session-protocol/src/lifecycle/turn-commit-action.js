/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean } from "@noobot/shared/value";

export const TURN_COMMIT_ACTION = Object.freeze({
  SEND: "send",
  CONTINUE: "continue",
});

export const TURN_COMMIT_ACTION_VALUES = Object.freeze(Object.values(TURN_COMMIT_ACTION));

export function normalizeTurnCommitAction(value = "") {
  return clean(value).toLowerCase();
}

export function isTurnCommitAction(value = "") {
  return TURN_COMMIT_ACTION_VALUES.includes(normalizeTurnCommitAction(value));
}

export function requireTurnCommitAction(value = "") {
  const normalized = normalizeTurnCommitAction(value);
  if (!TURN_COMMIT_ACTION_VALUES.includes(normalized)) {
    throw Object.assign(new TypeError(`invalid turn commit action: ${String(value)}`), {
      code: "TURN_COMMIT_ACTION_INVALID",
    });
  }
  return normalized;
}

export function isTurnCommitContinuation(value = "") {
  return normalizeTurnCommitAction(value) === TURN_COMMIT_ACTION.CONTINUE;
}
