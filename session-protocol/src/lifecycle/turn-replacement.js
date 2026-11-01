/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";

import { collectTurnScopeIdErrors } from "./turn-field-assertions.js";
import { isCanonicalTurnScopeId } from "../identity/turn-scope-identity.js";

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

export function collectTurnReplacementTombstoneErrors(replacement, lifecycleSequence) {
  const errors = [];
  const turnScopeId = replacement?.turnScopeId;
  const replacementTurnScopeId = replacement?.replacementTurnScopeId;
  const replacedTurnScopeIds = Array.isArray(replacement?.replacedTurnScopeIds)
    ? replacement.replacedTurnScopeIds
    : [];
  errors.push(
    ...collectTurnScopeIdErrors(turnScopeId, {
      missingCode: "missing_replaced_turn_scope_id",
      nonCanonicalCode: "non_canonical_replaced_turn_scope_id",
    }),
  );
  if (!isCanonicalText(replacement?.replacementDialogProcessId))
    errors.push("missing_replacement_dialog_process_id");
  if (!isCanonicalText(replacement?.requestHash)) errors.push("missing_replacement_request_hash");
  errors.push(
    ...collectTurnScopeIdErrors(replacementTurnScopeId, {
      missingCode: "missing_replacement_turn_scope_id",
      nonCanonicalCode: "non_canonical_replacement_turn_scope_id",
    }),
  );
  if (!isCanonicalText(replacement?.replacementUserMessageUid))
    errors.push("missing_replacement_user_message_uid");
  if (!isCanonicalText(replacement?.commandId)) errors.push("missing_replacement_command_id");
  if (
    !Number.isInteger(replacement?.committedAggregateVersion) ||
    replacement.committedAggregateVersion < 1
  )
    errors.push("invalid_replacement_committed_version");
  if (
    !replacedTurnScopeIds.length ||
    !replacedTurnScopeIds.every(isCanonicalTurnScopeId) ||
    new Set(replacedTurnScopeIds).size !== replacedTurnScopeIds.length ||
    !replacedTurnScopeIds.includes(turnScopeId)
  )
    errors.push("invalid_replaced_turn_scope_ids");
  if (replacedTurnScopeIds.includes(replacementTurnScopeId))
    errors.push("replacement_scope_reuses_replaced_scope");
  if (
    !Number.isInteger(replacement?.sequence) ||
    replacement.sequence < 1 ||
    replacement.sequence > lifecycleSequence
  )
    errors.push("invalid_replacement_sequence");
  if (!isCanonicalText(replacement?.committedAt)) errors.push("missing_replacement_committed_at");
  return errors;
}
