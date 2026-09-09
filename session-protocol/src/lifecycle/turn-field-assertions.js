/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  canonicalizeTurnScopeId,
  isCanonicalTurnScopeId,
} from "../identity/turn-scope-identity.js";

const clean = (value) => String(value || "").trim();

export function collectTurnScopeIdErrors(
  turnScopeId,
  { missingCode = "missing_turn_scope_id", nonCanonicalCode = "non_canonical_turn_scope_id" } = {},
) {
  if (!canonicalizeTurnScopeId(turnScopeId)) return [missingCode];
  if (!isCanonicalTurnScopeId(turnScopeId)) return [nonCanonicalCode];
  return [];
}

export function collectPositiveIntegerErrors(value, code, { minimum = 1 } = {}) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < minimum) return [code];
  return [];
}

export function collectRequiredFieldErrors(value, code) {
  return clean(value) ? [] : [code];
}

export function collectTurnMaterializationErrors(turn = {}) {
  return [
    ...collectTurnScopeIdErrors(turn.turnScopeId),
    ...collectRequiredFieldErrors(turn.messageId, "missing_message_id"),
    ...collectRequiredFieldErrors(turn.presentationMessageId, "missing_presentation_message_id"),
    ...collectPositiveIntegerErrors(turn.revision, "invalid_turn_revision"),
    ...collectPositiveIntegerErrors(turn.sequence, "invalid_turn_sequence"),
  ];
}
