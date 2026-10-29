/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";

const TURN_REPLACEMENT_PROTOCOL_VERSION = 1;
const TURN_REPLACEMENT_EVENT = "turn.replaced";

function isCommittedAggregateVersion(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function isUniqueCanonicalTextList(value) {
  return (
    Array.isArray(value) && value.every(isCanonicalText) && new Set(value).size === value.length
  );
}

export function validateTurnReplacementCommit(commit) {
  if (!isPlainObject(commit)) {
    return Object.freeze({ valid: false, errors: Object.freeze(["commit_not_object"]) });
  }
  const errors = [];
  if (commit.protocolVersion !== TURN_REPLACEMENT_PROTOCOL_VERSION) {
    errors.push("unsupported_protocol_version");
  }
  if (commit.eventType !== TURN_REPLACEMENT_EVENT) errors.push("invalid_event_type");
  if (!isCanonicalText(commit.commandId)) errors.push("missing_command_id");
  if (!isCanonicalText(commit.sessionId)) errors.push("missing_session_id");
  if (!isCommittedAggregateVersion(commit.committedAggregateVersion)) {
    errors.push("invalid_committed_aggregate_version");
  }
  if (
    !isUniqueCanonicalTextList(commit.replacedTurnScopeIds) ||
    !commit.replacedTurnScopeIds.length
  ) {
    errors.push("invalid_replaced_turn_scope_ids");
  }
  if (!isCanonicalText(commit.replacementDialogProcessId)) {
    errors.push("missing_replacement_dialog_process_id");
  }
  if (!isCanonicalText(commit.replacementTurnScopeId)) {
    errors.push("missing_replacement_turn_scope_id");
  }
  if (!isCanonicalText(commit.replacementUserMessageUid)) {
    errors.push("missing_replacement_user_message_uid");
  }
  if (!isCanonicalText(commit.requestHash)) errors.push("missing_request_hash");
  if (!isCanonicalText(commit.committedAt)) errors.push("missing_committed_at");
  if (
    Array.isArray(commit.replacedTurnScopeIds) &&
    commit.replacedTurnScopeIds.includes(commit.replacementTurnScopeId)
  ) {
    errors.push("replacement_scope_reuses_replaced_scope");
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function assertTurnReplacementCommit(commit) {
  const validation = validateTurnReplacementCommit(commit);
  if (!validation.valid) {
    throw new TypeError(`invalid turn replacement commit: ${validation.errors.join(",")}`);
  }
  return commit;
}

export function createTurnReplacementCommit({
  commandId,
  sessionId,
  committedAggregateVersion,
  replacedTurnScopeIds,
  replacementDialogProcessId,
  replacementTurnScopeId,
  replacementUserMessageUid,
  requestHash,
  committedAt,
}) {
  const commit = assertTurnReplacementCommit({
    protocolVersion: TURN_REPLACEMENT_PROTOCOL_VERSION,
    eventType: TURN_REPLACEMENT_EVENT,
    commandId,
    sessionId,
    committedAggregateVersion,
    replacedTurnScopeIds,
    replacementDialogProcessId,
    replacementTurnScopeId,
    replacementUserMessageUid,
    requestHash,
    committedAt,
  });
  return Object.freeze({
    ...commit,
    replacedTurnScopeIds: Object.freeze([...commit.replacedTurnScopeIds]),
  });
}
