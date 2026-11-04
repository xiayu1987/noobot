/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, text as clean } from "@noobot/shared/value";
import { isSettledTurn } from "../lifecycle/turn-state.js";
import { normalizeCommandReceipt } from "../command/command-receipt.js";
import { validateTurnCommitMetadata } from "./turn-commit-metadata.js";
import { validateCanonicalAssistantPresentation } from "../turn-presentation.js";
import { isSessionCaller } from "@noobot/shared/session-caller";
import { isCanonicalTurnScopeId } from "../identity/turn-scope-identity.js";
import { collectTurnRecordErrors } from "../lifecycle/turn-record.js";
import { collectTurnReplacementTombstoneErrors } from "../lifecycle/turn-replacement.js";

export function createEmptyTurnLifecycle() {
  return { activeTurnScopeId: "", sequence: 0, turns: {}, replacedTurns: {}, commandReceipts: [] };
}

export function isTurnLifecycleShape(lifecycle) {
  return (
    isPlainObject(lifecycle) &&
    isPlainObject(lifecycle.turns) &&
    isPlainObject(lifecycle.replacedTurns) &&
    Array.isArray(lifecycle.commandReceipts)
  );
}

function collectLifecycleRecordErrors(lifecycle, field, collectRecordErrors, errors) {
  for (const [key, record] of Object.entries(lifecycle[field])) {
    if (!isPlainObject(record)) {
      errors.push(`invalid_lifecycle_record:${field}:${key}`);
      continue;
    }
    errors.push(...collectRecordErrors(record));
    if (!isCanonicalTurnScopeId(record.turnScopeId) || record.turnScopeId !== key) {
      errors.push(`lifecycle_record_identity_mismatch:${field}:${key}`);
    }
    if (
      !Number.isInteger(record.sequence) ||
      record.sequence < 1 ||
      record.sequence > lifecycle.sequence
    ) {
      errors.push(`invalid_lifecycle_record_sequence:${field}:${key}`);
    }
  }
}

function collectTurnContinuationRelationErrors(lifecycle, turn, errors) {
  if (isPlainObject(turn.continuationSource)) {
    const source = lifecycle.turns[turn.continuationSource.turnScopeId];
    if (
      !source ||
      source.state !== "stop_completed" ||
      source.dialogProcessId !== turn.continuationSource.dialogProcessId ||
      source.continuedByTurnScopeId !== turn.turnScopeId ||
      source.sequence >= turn.sequence
    )
      errors.push("turn_continuation_source_relation_mismatch");
  }
  if (turn.continuedByTurnScopeId) {
    const target = lifecycle.turns[turn.continuedByTurnScopeId];
    if (
      !target ||
      target.continuationSource?.turnScopeId !== turn.turnScopeId ||
      target.continuationSource?.dialogProcessId !== turn.dialogProcessId
    )
      errors.push("turn_continuation_target_relation_mismatch");
  }
}

export function assertTurnLifecycleRecordIntegrity(lifecycle) {
  if (!isTurnLifecycleShape(lifecycle)) {
    throw Object.assign(new TypeError("invalid turn lifecycle: invalid_turn_lifecycle_shape"), {
      code: "TURN_LIFECYCLE_RECORD_INVALID",
      protocolErrors: ["invalid_turn_lifecycle_shape"],
    });
  }
  const errors = [];
  if (!Number.isInteger(lifecycle.sequence) || lifecycle.sequence < 0) {
    errors.push("invalid_lifecycle_sequence");
  }
  collectLifecycleRecordErrors(lifecycle, "turns", collectTurnRecordErrors, errors);
  collectLifecycleRecordErrors(
    lifecycle,
    "replacedTurns",
    (record) => collectTurnReplacementTombstoneErrors(record, lifecycle.sequence),
    errors,
  );
  const active = lifecycle.activeTurnScopeId;
  for (const turn of Object.values(lifecycle.turns)) {
    if (!isPlainObject(turn)) continue;
    collectTurnContinuationRelationErrors(lifecycle, turn, errors);
  }
  if (
    active !== "" &&
    (!isCanonicalTurnScopeId(active) ||
      !lifecycle.turns[active] ||
      isSettledTurn(lifecycle.turns[active]))
  ) {
    errors.push("invalid_active_turn");
  }
  if (Object.keys(lifecycle.turns).some((scope) => Object.hasOwn(lifecycle.replacedTurns, scope))) {
    errors.push("replaced_turn_materialized");
  }
  const commandIds = new Set();
  for (const receipt of lifecycle.commandReceipts) {
    if (!normalizeCommandReceipt(receipt)) errors.push("invalid_command_receipt");
    if (commandIds.has(receipt?.commandId)) errors.push("duplicate_command_receipt");
    commandIds.add(receipt?.commandId);
  }
  if (errors.length) {
    throw Object.assign(new TypeError(`invalid turn lifecycle: ${errors.join(",")}`), {
      code: "TURN_LIFECYCLE_RECORD_INVALID",
      protocolErrors: errors,
    });
  }
  return lifecycle;
}

export function validateSessionAggregateShape(session) {
  if (!isPlainObject(session)) return ["invalid_session"];
  const errors = [];

  if (typeof session.sessionId !== "string" || !session.sessionId)
    errors.push("invalid_session_id");
  if (typeof session.parentSessionId !== "string") errors.push("invalid_parent_session_id");
  if (!isSessionCaller(session.caller)) errors.push("invalid_caller");
  if (!Array.isArray(session.messages) || !session.messages.every(isPlainObject)) {
    errors.push("invalid_messages");
  }
  if (!Array.isArray(session.dialogOrder)) errors.push("invalid_dialog_order");
  if (!Array.isArray(session.turnTimings)) errors.push("invalid_turn_timings");
  if (!isTurnLifecycleShape(session.turnLifecycle)) errors.push("invalid_turn_lifecycle");
  return errors;
}

function invalidSessionAggregate(errors) {
  const error = new TypeError(`invalid session aggregate: ${errors.join(",")}`);
  error.code = "SESSION_PROTOCOL_INVALID";
  error.protocolErrors = errors;
  return error;
}

export function assertSessionAggregateShape(session) {
  const errors = validateSessionAggregateShape(session);
  if (errors.length) throw invalidSessionAggregate(errors);
  return session;
}

export function validateSessionAggregateInvariants(session) {
  const shapeErrors = validateSessionAggregateShape(session);
  if (shapeErrors.length) {
    return Object.freeze({ valid: false, errors: Object.freeze(shapeErrors) });
  }
  const errors = [];
  const { messages, turnLifecycle: lifecycle } = session;
  const messageUids = new Set();
  const canonicalAssistantTurns = new Set();
  for (const message of messages) {
    const messageUid = clean(message?.messageUid);
    if (messageUid && messageUids.has(messageUid)) errors.push("duplicate_message_uid");
    messageUids.add(messageUid);
    if (message?.turnCommit && !validateTurnCommitMetadata(message.turnCommit).valid) {
      errors.push("invalid_turn_commit_metadata");
    }
    const presentation = validateCanonicalAssistantPresentation(message);
    errors.push(...presentation.errors);
    const presentationTurnScopeId = presentation.identity?.turnScopeId || "";
    if (presentationTurnScopeId && canonicalAssistantTurns.has(presentationTurnScopeId)) {
      errors.push("duplicate_canonical_assistant_presentation");
    }
    if (presentationTurnScopeId) canonicalAssistantTurns.add(presentationTurnScopeId);
  }
  const activeTurnScopeId = clean(lifecycle.activeTurnScopeId);
  if (
    activeTurnScopeId &&
    (!lifecycle.turns[activeTurnScopeId] || isSettledTurn(lifecycle.turns[activeTurnScopeId]))
  ) {
    errors.push("invalid_active_turn");
  }
  const replaced = new Set(Object.keys(lifecycle.replacedTurns));
  if (Object.keys(lifecycle.turns).some((turnScopeId) => replaced.has(turnScopeId)))
    errors.push("replaced_turn_materialized");
  const commandIds = new Set();
  for (const receipt of lifecycle.commandReceipts) {
    const normalized = normalizeCommandReceipt(receipt);
    if (!normalized) {
      errors.push("invalid_command_receipt");
      continue;
    }
    if (commandIds.has(normalized.commandId)) errors.push("duplicate_command_receipt");
    commandIds.add(normalized.commandId);
  }
  if (Object.hasOwn(session, "turnStatuses")) errors.push("duplicate_terminal_fact");
  if (Object.hasOwn(session, "mutationReceipts")) errors.push("duplicate_command_receipts");
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function assertSessionAggregateInvariants(session) {
  const result = validateSessionAggregateInvariants(session);
  if (!result.valid) throw invalidSessionAggregate([...result.errors]);
  return session;
}
