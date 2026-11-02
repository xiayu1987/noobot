/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isCanonicalText, isPlainObject } from "@noobot/shared/value";

export function requireTurnRecoveryCommitResult(result) {
  if (
    !isPlainObject(result) ||
    typeof result.applied !== "boolean" ||
    (result.deduplicated !== undefined && typeof result.deduplicated !== "boolean") ||
    (!result.applied && result.deduplicated !== true && !isCanonicalText(result.reason))
  ) {
    throw Object.assign(new TypeError("invalid turn recovery commit result"), {
      code: "TURN_RECOVERY_COMMIT_RESULT_INVALID",
    });
  }
  return result;
}

export function requireTurnExecutionObservation(observation) {
  if (
    !isPlainObject(observation) ||
    typeof observation.alive !== "boolean" ||
    !Number.isSafeInteger(observation.observedAtMs) ||
    observation.observedAtMs < 0
  ) {
    throw Object.assign(new TypeError("invalid turn execution observation"), {
      code: "TURN_EXECUTION_OBSERVATION_INVALID",
    });
  }
  return observation;
}

export const TURN_RECOVERY_ACTION = Object.freeze({
  NONE: "none",
  FINALIZE: "finalize",
  ORPHAN: "orphan",
});

export const TURN_ORPHAN_RECOVERY = Object.freeze({
  failure: Object.freeze({
    code: "service_restart_orphaned_turn",
    message: "active turn execution was lost after service restart",
    retryable: false,
  }),
  terminalCommand: "error",
});

const RECOVERY_ACTIONS = new Set(Object.values(TURN_RECOVERY_ACTION));

export function isTurnRecoveryAction(value) {
  return RECOVERY_ACTIONS.has(value);
}

export function isActionableTurnRecovery(value) {
  return value === TURN_RECOVERY_ACTION.FINALIZE || value === TURN_RECOVERY_ACTION.ORPHAN;
}
