/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, text as clean } from "@noobot/shared/value";
import { isCanonicalTurnScopeId } from "../identity/turn-scope-identity.js";
import { TURN_STATE } from "./turn-state.js";

const TURN_STATES = new Set(Object.values(TURN_STATE));

export function collectTurnScopeIdErrors(
  turnScopeId,
  { missingCode = "missing_turn_scope_id", nonCanonicalCode = "non_canonical_turn_scope_id" } = {},
) {
  if (isCanonicalTurnScopeId(turnScopeId)) return [];
  return turnScopeId == null || turnScopeId === "" ? [missingCode] : [nonCanonicalCode];
}

export function collectPositiveIntegerErrors(value, code, { minimum = 1 } = {}) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < minimum) return [code];
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

export function collectTurnMaterializationErrors(turn = {}) {
  return [
    ...collectTurnScopeIdErrors(turn.turnScopeId),
    ...collectRequiredFieldErrors(turn.sessionId, "missing_turn_session_id"),
    ...collectRequiredFieldErrors(turn.presentationMessageId, "missing_presentation_message_id"),
    ...collectDialogProcessIdErrors(turn.dialogProcessId),
    ...(TURN_STATES.has(turn.state) ? [] : ["invalid_turn_state"]),
    ...collectPositiveIntegerErrors(turn.revision, "invalid_turn_revision"),
    ...collectPositiveIntegerErrors(turn.sequence, "invalid_turn_sequence"),
  ];
}
