/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  canonicalizeTurnScopeId,
  isCanonicalTurnScopeId,
} from "@noobot/session-protocol/turn-scope-identity";

const clean = (value) => String(value || "").trim();

export function normalizeSessionId(value = "") {
  return clean(value).slice(0, 200);
}

export function normalizeParentSessionId(value = "") {
  return normalizeSessionId(value);
}

export function normalizeDialogProcessId(value = "") {
  return clean(value);
}

export function createSessionScope({ userId = "", sessionId = "", parentSessionId = "" } = {}) {
  return Object.freeze({
    userId: clean(userId),
    sessionId: normalizeSessionId(sessionId),
    parentSessionId: normalizeParentSessionId(parentSessionId),
  });
}

export function validateSessionScope(scope = {}) {
  const errors = [];
  if (!scope || typeof scope !== "object" || Array.isArray(scope))
    return { valid: false, errors: ["invalid_scope"] };
  if (!clean(scope.userId)) errors.push("missing_user_id");
  if (!clean(scope.sessionId)) errors.push("missing_session_id");
  const keys = Object.keys(scope);
  if (keys.some((key) => !["userId", "sessionId", "parentSessionId"].includes(key)))
    errors.push("unknown_scope_field");
  return { valid: errors.length === 0, errors };
}

export function createTurnIdentity({ dialogProcessId = "", turnScopeId = "" } = {}) {
  return Object.freeze({
    dialogProcessId: normalizeDialogProcessId(dialogProcessId),
    turnScopeId: canonicalizeTurnScopeId(turnScopeId),
  });
}

export function validateTurnIdentity(turn = {}) {
  const errors = [];
  if (!clean(turn.dialogProcessId)) errors.push("missing_dialog_process_id");
  if (!canonicalizeTurnScopeId(turn.turnScopeId)) errors.push("missing_turn_scope_id");
  else if (!isCanonicalTurnScopeId(turn.turnScopeId)) errors.push("non_canonical_turn_scope_id");
  return { valid: errors.length === 0, errors };
}

export function sessionIdentity(session = {}) {
  return clean(session.sessionId);
}

export function isSameSession(left = {}, right = {}) {
  const leftId = typeof left === "string" ? clean(left) : sessionIdentity(left);
  const rightId = typeof right === "string" ? clean(right) : sessionIdentity(right);
  return Boolean(leftId) && leftId === rightId;
}
