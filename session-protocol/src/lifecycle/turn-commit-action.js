/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean } from "../normalize.js";

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

export function resolveTurnCommitAction(value = "") {
  const normalized = normalizeTurnCommitAction(value);
  return normalized === TURN_COMMIT_ACTION.CONTINUE
    ? TURN_COMMIT_ACTION.CONTINUE
    : TURN_COMMIT_ACTION.SEND;
}

export function isTurnCommitContinuation(value = "") {
  return normalizeTurnCommitAction(value) === TURN_COMMIT_ACTION.CONTINUE;
}
