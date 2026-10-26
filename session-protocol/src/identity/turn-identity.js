/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean } from "@noobot/shared/value";
import { isCanonicalTurnScopeId } from "./turn-scope-identity.js";

export function normalizeTurnIdentity({ turnScopeId = "", dialogProcessId = "" } = {}) {
  return Object.freeze({
    turnScopeId,
    dialogProcessId: clean(dialogProcessId),
  });
}

export function validateTurnIdentity(value = {}) {
  const identity = normalizeTurnIdentity(value);
  const errors = [];
  if (!identity.turnScopeId) errors.push("missing_turn_scope_id");
  else if (!isCanonicalTurnScopeId(identity.turnScopeId))
    errors.push("non_canonical_turn_scope_id");
  if (!identity.dialogProcessId) errors.push("missing_dialog_process_id");
  return { valid: errors.length === 0, errors, identity };
}
