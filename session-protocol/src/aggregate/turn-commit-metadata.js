/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean, isPlainObject, isObjectLike } from "@noobot/shared/value";
import { isTurnCommitAction, requireTurnCommitAction } from "../lifecycle/turn-commit-action.js";

const TURN_COMMIT_METADATA_KEYS = Object.freeze([
  "action",
  "commandId",
  "requestHash",
  "resumeDialogProcessId",
  "resumeTurnScopeId",
]);

export function normalizeTurnCommitMetadata(turnCommit = null) {
  if (!isPlainObject(turnCommit)) return null;
  const commandId = clean(turnCommit.commandId);
  if (!commandId) return null;
  const normalized = {
    action: requireTurnCommitAction(turnCommit.action),
    commandId,
  };
  const requestHash = clean(turnCommit.requestHash);
  if (requestHash) normalized.requestHash = requestHash;
  for (const key of ["resumeDialogProcessId", "resumeTurnScopeId"]) {
    const value = clean(turnCommit[key]);
    if (value) normalized[key] = value;
  }
  return normalized;
}

export function validateTurnCommitMetadata(turnCommit = null) {
  if (isObjectLike(turnCommit) && !isTurnCommitAction(turnCommit.action)) {
    return Object.freeze({ valid: false, errors: Object.freeze(["invalid_turn_commit_action"]) });
  }
  const normalized = normalizeTurnCommitMetadata(turnCommit);
  const errors = [];
  if (!normalized)
    return Object.freeze({ valid: false, errors: Object.freeze(["invalid_turn_commit"]) });
  if (Object.keys(turnCommit).some((key) => !TURN_COMMIT_METADATA_KEYS.includes(key))) {
    errors.push("unknown_turn_commit_field");
  }
  for (const [key, value] of Object.entries(normalized)) {
    if (turnCommit[key] !== value) errors.push(`non_canonical_turn_commit_${key}`);
  }
  for (const key of TURN_COMMIT_METADATA_KEYS) {
    if (Object.hasOwn(turnCommit, key) && !Object.hasOwn(normalized, key)) {
      errors.push(`empty_turn_commit_${key}`);
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
