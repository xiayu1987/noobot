/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { SESSION_ERROR_CODE } from "../errors.js";
import { isCanonicalDialogProcessKey } from "../identity.js";
import { collectTurnScopeIdErrors } from "../lifecycle/turn-field-assertions.js";

export function collectTurnLookupKeyErrors(key) {
  if (!isPlainObject(key)) return ["turn_lookup_key_not_object"];
  return [
    ...collectTurnScopeIdErrors(key.turnScopeId),
    ...(isCanonicalDialogProcessKey(key.dialogProcessId) ? [] : ["invalid_dialog_process_id"]),
  ];
}

export function requireTurnLookupKey(key) {
  const errors = collectTurnLookupKeyErrors(key);
  if (!errors.length) {
    return Object.freeze({ turnScopeId: key.turnScopeId, dialogProcessId: key.dialogProcessId });
  }
  throw Object.assign(new TypeError(`invalid turn lookup key: ${errors.join(",")}`), {
    statusCode: 400,
    code: SESSION_ERROR_CODE.TURN_LOOKUP_KEY_INVALID,
    validationErrors: errors,
  });
}

export function matchesTurnLookupKey(turn, key) {
  return turn.turnScopeId === key.turnScopeId && turn.dialogProcessId === key.dialogProcessId;
}

export function createTurnArtifactRevision({ turnId, committedBytes }) {
  return `turn-journal:${turnId}:${committedBytes}`;
}
