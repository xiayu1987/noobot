/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { canonicalizeTurnScopeId } from "../identity/turn-scope-identity.mjs";
import { TURN_STATE } from "./turn-state.mjs";

const clean = (value) => String(value || "").trim();

export function normalizeTurnContinuationSource(source = null) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const normalized = {
    turnScopeId: canonicalizeTurnScopeId(source.turnScopeId),
    dialogProcessId: clean(source.dialogProcessId),
  };
  return normalized.turnScopeId && normalized.dialogProcessId ? Object.freeze(normalized) : null;
}

export function decideTurnContinuation({ lifecycle = {}, turnScopeId = "", source = null } = {}) {
  const identity = normalizeTurnContinuationSource(source);
  const targetTurnScopeId = canonicalizeTurnScopeId(turnScopeId);
  if (!identity) return Object.freeze({ allowed: false, reason: "continue_source_identity_incomplete" });
  if (!targetTurnScopeId) return Object.freeze({ allowed: false, reason: "continue_target_identity_incomplete" });
  const sourceTurn = lifecycle?.turns?.[identity.turnScopeId];
  if (!sourceTurn || clean(sourceTurn.dialogProcessId) !== identity.dialogProcessId ||
      sourceTurn.state !== TURN_STATE.STOP_COMPLETED || sourceTurn.executionState !== "user_stopped") {
    return Object.freeze({ allowed: false, reason: "continue_source_not_stopped" });
  }
  if (clean(sourceTurn.continuedByTurnScopeId) && clean(sourceTurn.continuedByTurnScopeId) !== targetTurnScopeId) {
    return Object.freeze({ allowed: false, reason: "continue_source_consumed" });
  }
  return Object.freeze({ allowed: true, sourceTurn, source: identity });
}

export function decideMaterializedTurnContinuation({ lifecycle = {}, turnScopeId = "", source = null } = {}) {
  const decision = decideTurnContinuation({ lifecycle, turnScopeId, source });
  if (!decision.allowed) return decision;
  const targetTurnScopeId = canonicalizeTurnScopeId(turnScopeId);
  if (clean(decision.sourceTurn.continuedByTurnScopeId) !== targetTurnScopeId) {
    return Object.freeze({ allowed: false, reason: "continue_source_relation_missing" });
  }
  const targetTurn = lifecycle?.turns?.[targetTurnScopeId];
  if (targetTurn?.action !== "continue" ||
      clean(targetTurn?.continuationSource?.turnScopeId) !== decision.source.turnScopeId ||
      clean(targetTurn?.continuationSource?.dialogProcessId) !== decision.source.dialogProcessId) {
    return Object.freeze({ allowed: false, reason: "continue_target_relation_mismatch" });
  }
  return Object.freeze({ ...decision, targetTurn });
}
