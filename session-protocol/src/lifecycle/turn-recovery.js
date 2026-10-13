/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TURN_RECOVERY_ACTION = Object.freeze({
  NONE: "none",
  FINALIZE: "finalize",
  ORPHAN: "orphan",
});

const RECOVERY_ACTIONS = new Set(Object.values(TURN_RECOVERY_ACTION));

export function isTurnRecoveryAction(value) {
  return RECOVERY_ACTIONS.has(value);
}

export function isActionableTurnRecovery(value) {
  return value === TURN_RECOVERY_ACTION.FINALIZE || value === TURN_RECOVERY_ACTION.ORPHAN;
}
