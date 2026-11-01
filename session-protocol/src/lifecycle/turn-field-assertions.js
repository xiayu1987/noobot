/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, text as clean } from "@noobot/shared/value";
import { isCanonicalTurnScopeId } from "../identity/turn-scope-identity.js";

export function collectTurnScopeIdErrors(
  turnScopeId,
  { missingCode = "missing_turn_scope_id", nonCanonicalCode = "non_canonical_turn_scope_id" } = {},
) {
  if (isCanonicalTurnScopeId(turnScopeId)) return [];
  return turnScopeId == null || turnScopeId === "" ? [missingCode] : [nonCanonicalCode];
}

export function collectPositiveIntegerErrors(value, code, { minimum = 1 } = {}) {
  if (!Number.isInteger(value) || value < minimum) return [code];
  return [];
}

export function collectRequiredFieldErrors(value, code) {
  return clean(value) ? [] : [code];
}

export function collectDialogProcessIdErrors(dialogProcessId) {
  return isCanonicalText(dialogProcessId) ? [] : ["missing_dialog_process_id"];
}

export function collectParentSessionIdErrors(parentSessionId) {
  if (parentSessionId === "") return [];
  return isCanonicalText(parentSessionId) ? [] : ["invalid_parent_session_id"];
}
