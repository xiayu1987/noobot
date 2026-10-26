/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean, isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { isCanonicalTurnScopeId } from "../identity/turn-scope-identity.js";
import { TURN_STATE } from "./turn-state.js";
import { TURN_EXECUTION_STATE, normalizeTurnExecutionState } from "./turn-execution-state.js";
import { isTurnCommitContinuation } from "./turn-commit-action.js";

export function normalizeTurnContinuationSource(source = null) {
  if (!isPlainObject(source)) return null;
  if (!isCanonicalTurnScopeId(source.turnScopeId) || !isCanonicalText(source.dialogProcessId)) {
    throw Object.assign(new TypeError("turn continuation source requires canonical identity"), {
      code: "TURN_CONTINUATION_SOURCE_INVALID",
    });
  }
  return Object.freeze({
    turnScopeId: source.turnScopeId,
    dialogProcessId: source.dialogProcessId,
  });
}

export function decideTurnContinuation({ lifecycle = {}, turnScopeId = "", source = null } = {}) {
  if (
    !isPlainObject(source) ||
    !isCanonicalTurnScopeId(source.turnScopeId) ||
    !isCanonicalText(source.dialogProcessId)
  )
    return Object.freeze({ allowed: false, reason: "continue_source_identity_incomplete" });
  const identity = normalizeTurnContinuationSource(source);
  const targetTurnScopeId = turnScopeId;
  if (!isCanonicalTurnScopeId(targetTurnScopeId))
    return Object.freeze({ allowed: false, reason: "continue_target_identity_incomplete" });
  const sourceTurn = lifecycle?.turns?.[identity.turnScopeId];
  if (
    !sourceTurn ||
    clean(sourceTurn.dialogProcessId) !== identity.dialogProcessId ||
    sourceTurn.state !== TURN_STATE.STOP_COMPLETED ||
    normalizeTurnExecutionState(sourceTurn.executionState) !== TURN_EXECUTION_STATE.USER_STOPPED
  ) {
    return Object.freeze({ allowed: false, reason: "continue_source_not_stopped" });
  }
  if (
    clean(sourceTurn.continuedByTurnScopeId) &&
    clean(sourceTurn.continuedByTurnScopeId) !== targetTurnScopeId
  ) {
    return Object.freeze({ allowed: false, reason: "continue_source_consumed" });
  }
  return Object.freeze({ allowed: true, sourceTurn, source: identity });
}

export function decideMaterializedTurnContinuation({
  lifecycle = {},
  turnScopeId = "",
  source = null,
} = {}) {
  const decision = decideTurnContinuation({ lifecycle, turnScopeId, source });
  if (!decision.allowed) return decision;
  const targetTurnScopeId = turnScopeId;
  if (clean(decision.sourceTurn.continuedByTurnScopeId) !== targetTurnScopeId) {
    return Object.freeze({ allowed: false, reason: "continue_source_relation_missing" });
  }
  const targetTurn = lifecycle?.turns?.[targetTurnScopeId];
  if (
    !isTurnCommitContinuation(targetTurn?.action) ||
    clean(targetTurn?.continuationSource?.turnScopeId) !== decision.source.turnScopeId ||
    clean(targetTurn?.continuationSource?.dialogProcessId) !== decision.source.dialogProcessId
  ) {
    return Object.freeze({ allowed: false, reason: "continue_target_relation_mismatch" });
  }
  return Object.freeze({ ...decision, targetTurn });
}
