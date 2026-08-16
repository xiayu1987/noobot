/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { canonicalizeTurnScopeId, isCanonicalTurnScopeId } from "./turn-scope-identity.js";
const clean = (value) => String(value || "").trim();

export function normalizeTurnIdentity({ turnScopeId = "", dialogProcessId = "" } = {}) {
  return Object.freeze({
    turnScopeId: canonicalizeTurnScopeId(turnScopeId),
    dialogProcessId: clean(dialogProcessId),
  });
}

export function validateTurnIdentity(value = {}) {
  const identity = normalizeTurnIdentity(value);
  const errors = [];
  if (!identity.turnScopeId) errors.push("missing_turn_scope_id");
  else if (!isCanonicalTurnScopeId(value.turnScopeId)) errors.push("non_canonical_turn_scope_id");
  if (!identity.dialogProcessId) errors.push("missing_dialog_process_id");
  return { valid: errors.length === 0, errors, identity };
}

export function compareTurnIdentity(left = {}, right = {}) {
  const a = normalizeTurnIdentity(left);
  const b = normalizeTurnIdentity(right);
  if (!a.turnScopeId || !b.turnScopeId)
    return Object.freeze({ matched: false, reason: "turn_scope_identity_incomplete" });
  if (a.turnScopeId !== b.turnScopeId)
    return Object.freeze({ matched: false, reason: "turn_scope_identity_mismatch" });
  if (a.dialogProcessId && b.dialogProcessId && a.dialogProcessId !== b.dialogProcessId) {
    return Object.freeze({ matched: false, reason: "dialog_process_identity_conflict" });
  }
  return Object.freeze({ matched: true, reason: "" });
}

export function isSameTurnIdentity(left = {}, right = {}) {
  return compareTurnIdentity(left, right).matched;
}
