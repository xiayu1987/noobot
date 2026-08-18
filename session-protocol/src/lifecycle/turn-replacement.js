/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TURN_REPLACEMENT_PROTOCOL_VERSION = 1;
export const TURN_REPLACEMENT_EVENT = "turn.replaced";

const text = (value) => String(value || "").trim();

export function createTurnReplacementCommit({
  commandId,
  sessionId,
  committedAggregateVersion,
  replacedTurnScopeIds = [],
  replacementDialogProcessId,
  replacementTurnScopeId,
  replacementUserMessageId,
  requestHash,
  committedAt = new Date().toISOString(),
} = {}) {
  return Object.freeze({
    protocolVersion: TURN_REPLACEMENT_PROTOCOL_VERSION,
    eventType: TURN_REPLACEMENT_EVENT,
    commandId: text(commandId),
    sessionId: text(sessionId),
    committedAggregateVersion: Number(committedAggregateVersion || 0),
    replacedTurnScopeIds: Object.freeze([
      ...new Set(
        (Array.isArray(replacedTurnScopeIds) ? replacedTurnScopeIds : []).map(text).filter(Boolean),
      ),
    ]),
    replacementDialogProcessId: text(replacementDialogProcessId),
    replacementTurnScopeId: text(replacementTurnScopeId),
    replacementUserMessageId: text(replacementUserMessageId),
    requestHash: text(requestHash),
    committedAt: text(committedAt),
  });
}

export function validateTurnReplacementCommit(commit = {}) {
  const errors = [];
  if (Number(commit?.protocolVersion) !== TURN_REPLACEMENT_PROTOCOL_VERSION)
    errors.push("unsupported_protocol_version");
  if (text(commit?.eventType) !== TURN_REPLACEMENT_EVENT) errors.push("invalid_event_type");
  if (!text(commit?.commandId)) errors.push("missing_command_id");
  if (!text(commit?.sessionId)) errors.push("missing_session_id");
  if (
    !Number.isInteger(Number(commit?.committedAggregateVersion)) ||
    Number(commit.committedAggregateVersion) < 1
  )
    errors.push("invalid_committed_aggregate_version");
  if (!Array.isArray(commit?.replacedTurnScopeIds) || !commit.replacedTurnScopeIds.length)
    errors.push("missing_replaced_turn_scope_ids");
  if (!text(commit?.replacementDialogProcessId))
    errors.push("missing_replacement_dialog_process_id");
  if (!text(commit?.replacementTurnScopeId)) errors.push("missing_replacement_turn_scope_id");
  if (!text(commit?.replacementUserMessageId)) errors.push("missing_replacement_user_message_id");
  if (!text(commit?.requestHash)) errors.push("missing_request_hash");
  if (commit?.replacedTurnScopeIds?.map(text).includes(text(commit?.replacementTurnScopeId))) {
    errors.push("replacement_scope_reuses_replaced_scope");
  }
  if (!text(commit?.committedAt)) errors.push("missing_committed_at");
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function assertTurnReplacementCommit(commit = {}) {
  const validation = validateTurnReplacementCommit(commit);
  if (!validation.valid) {
    throw new TypeError(`invalid turn replacement commit: ${validation.errors.join(",")}`);
  }
  return commit;
}

export function assertTurnReplacementMaterialization({ commit = {}, session = {} } = {}) {
  assertTurnReplacementCommit(commit);
  const sessionId = text(session?.sessionId);
  const aggregateVersion = Number(session?.aggregateVersion);
  if (sessionId !== text(commit.sessionId)) {
    throw new TypeError("invalid turn replacement materialization: session_identity_mismatch");
  }
  if (aggregateVersion !== Number(commit.committedAggregateVersion)) {
    throw new TypeError("invalid turn replacement materialization: aggregate_version_mismatch");
  }
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const replacementUsers = messages.filter(
    (message = {}) => text(message?.messageId) === text(commit.replacementUserMessageId),
  );
  if (replacementUsers.length !== 1 || text(replacementUsers[0]?.role).toLowerCase() !== "user") {
    throw new TypeError("invalid turn replacement materialization: replacement_user_missing");
  }
  const replacementUser = replacementUsers[0];
  if (text(replacementUser?.turnScopeId) !== text(commit.replacementTurnScopeId)) {
    throw new TypeError("invalid turn replacement materialization: replacement_scope_mismatch");
  }
  if (text(replacementUser?.dialogProcessId) !== text(commit.replacementDialogProcessId)) {
    throw new TypeError(
      "invalid turn replacement materialization: replacement_dialog_process_mismatch",
    );
  }
  const replacementScopeMessages = messages.filter(
    (message = {}) => text(message?.turnScopeId) === text(commit.replacementTurnScopeId),
  );
  if (replacementScopeMessages.length !== 1 || replacementScopeMessages[0] !== replacementUser) {
    throw new TypeError(
      "invalid turn replacement materialization: replacement_scope_not_user_only",
    );
  }
  const replacedScopes = new Set(commit.replacedTurnScopeIds.map(text));
  if (messages.some((message = {}) => replacedScopes.has(text(message?.turnScopeId)))) {
    throw new TypeError(
      "invalid turn replacement materialization: replaced_scope_still_materialized",
    );
  }
  return Object.freeze({ commit, session, replacementUser });
}
