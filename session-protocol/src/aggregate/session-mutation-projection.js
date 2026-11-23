/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { SESSION_ERROR_CODE } from "../errors.js";
import { SESSION_COMMAND } from "../command/session-command.js";
import {
  isCanonicalCommandReceipt,
  resolveMessageDeleteResultEffect,
} from "../command/command-receipt.js";
import { collectTurnRecordErrors } from "../lifecycle/turn-record.js";
import { collectTurnReplacementTombstoneErrors } from "../lifecycle/turn-replacement.js";
import { normalizeTurnTimingRecord } from "../lifecycle/turn-timing.js";
import { validateSessionMessageRecordIdentity } from "./session-message-record.js";
import { collectExactFieldErrors } from "./sessions-summary.js";
import { resolveSessionMessageSuffixEffect } from "./message-suffix.js";

const BASE_FIELDS = ["kind", "generation", "receipt"];
const COMMIT_FIELDS = [
  ...BASE_FIELDS,
  "baseAggregateVersion",
  "metadata",
  "lifecycleHead",
  "messageSuffix",
  "messages",
  "turns",
  "replacements",
  "timings",
];

function fail(reason) {
  throw Object.assign(new TypeError(`session mutation projection is invalid: ${reason}`), {
    code: SESSION_ERROR_CODE.SESSION_MUTATION_PROJECTION_INVALID,
  });
}

function requireEntityChanges(changes, validate) {
  if (!Array.isArray(changes)) fail("entity_changes_not_array");
  const keys = new Set();
  for (const change of changes) {
    if (
      !isPlainObject(change) ||
      collectExactFieldErrors(change, ["key", "value"]).length ||
      !isCanonicalText(change.key) ||
      keys.has(change.key)
    )
      fail("invalid_entity_change");
    keys.add(change.key);
    if (change.value === null) continue;
    if (
      !isPlainObject(change.value) ||
      change.value.turnScopeId !== change.key ||
      !validate(change.value)
    )
      fail("invalid_entity_value");
  }
}

function requireMessages(projection, sessionId) {
  if (!Array.isArray(projection.messages) || projection.messages.length > 1)
    fail("invalid_message_changes");
  for (const record of projection.messages) {
    if (
      !isPlainObject(record) ||
      !Number.isSafeInteger(record.ordinal) ||
      record.ordinal < 1 ||
      !Number.isSafeInteger(record.turnOrdinal) ||
      record.turnOrdinal < 1 ||
      validateSessionMessageRecordIdentity(record.message).length ||
      record.message.sessionId !== sessionId ||
      record.message.parentSessionId !== projection.metadata.parentSessionId
    )
      fail("invalid_message_record");
  }
}

function requireReplacementReceipt(receipt, sessionId) {
  if (receipt.type !== SESSION_COMMAND.TURN_REPLACE) return;
  const replacement = receipt.result.turnReplacement;
  if (
    replacement.sessionId !== sessionId ||
    replacement.commandId !== receipt.commandId ||
    replacement.committedAggregateVersion !== receipt.aggregateVersion ||
    replacement.requestHash !== receipt.requestHash ||
    replacement.committedAt !== receipt.committedAt
  )
    fail("replacement_receipt_mismatch");
}

function requireCommandEffect(projection) {
  const { receipt, messageSuffix, messages } = projection;
  const suffix = resolveSessionMessageSuffixEffect(messageSuffix);
  if (suffix === null) fail("invalid_message_suffix_bound");
  if (receipt.type === SESSION_COMMAND.MESSAGE_DELETE_FROM) {
    const deletion = resolveMessageDeleteResultEffect(receipt.result);
    if (
      messages.length ||
      deletion === null ||
      messageSuffix.firstOrdinal !== deletion.messageSuffix.firstOrdinal ||
      messageSuffix.previousMessageCount !== deletion.messageSuffix.previousMessageCount
    )
      fail("deletion_effect_mismatch");
    return;
  }
  const replacement = receipt.result.turnReplacement;
  const message = messages[0]?.message;
  if (
    messages.length !== 1 ||
    messages[0].ordinal !== messageSuffix.firstOrdinal ||
    messages[0].turnOrdinal !== 1 ||
    message.role !== "user" ||
    message.messageUid !== replacement.replacementUserMessageUid ||
    message.turnScopeId !== replacement.replacementTurnScopeId ||
    message.dialogProcessId !== replacement.replacementDialogProcessId
  )
    fail("replacement_effect_mismatch");
}

function requireCommandOrigin(projection, baseline) {
  if (
    (!baseline && projection.kind !== "commit") ||
    collectExactFieldErrors(projection, baseline ? BASE_FIELDS : COMMIT_FIELDS).length ||
    !Number.isSafeInteger(projection.generation) ||
    projection.generation < 1 ||
    baseline !== (projection.generation === 1) ||
    !isCanonicalCommandReceipt(projection.receipt) ||
    ![SESSION_COMMAND.MESSAGE_DELETE_FROM, SESSION_COMMAND.TURN_REPLACE].includes(
      projection.receipt.type,
    )
  )
    fail("invalid_command_origin");
}

function requireCommitMetadata(projection, sessionId) {
  const { metadata, lifecycleHead, receipt } = projection;
  if (
    !isPlainObject(metadata) ||
    metadata.sessionId !== sessionId ||
    (metadata.parentSessionId !== "" && !isCanonicalText(metadata.parentSessionId)) ||
    metadata.aggregateVersion !== receipt.aggregateVersion ||
    receipt.aggregateVersion < 1 ||
    projection.baseAggregateVersion !== receipt.aggregateVersion - 1 ||
    !isPlainObject(lifecycleHead) ||
    collectExactFieldErrors(lifecycleHead, ["sequence", "activeTurnScopeId"]).length ||
    !Number.isSafeInteger(lifecycleHead.sequence) ||
    lifecycleHead.sequence < 0 ||
    (lifecycleHead.activeTurnScopeId !== "" && !isCanonicalText(lifecycleHead.activeTurnScopeId))
  )
    fail("invalid_commit_metadata");
}

export function requireSessionMutationProjection(projection, { sessionId }) {
  if (!isCanonicalText(sessionId)) throw new TypeError("Mutation projection requires sessionId");
  if (!isPlainObject(projection)) fail("projection_not_object");
  const baseline = projection.kind === "baseline";
  requireCommandOrigin(projection, baseline);
  requireReplacementReceipt(projection.receipt, sessionId);
  if (baseline) return projection;
  requireCommitMetadata(projection, sessionId);
  const { lifecycleHead } = projection;
  requireMessages(projection, sessionId);
  requireCommandEffect(projection);
  requireEntityChanges(
    projection.turns,
    (turn) => !collectTurnRecordErrors(turn).length && turn.sequence <= lifecycleHead.sequence,
  );
  requireEntityChanges(
    projection.replacements,
    (turn) => !collectTurnReplacementTombstoneErrors(turn, lifecycleHead.sequence).length,
  );
  requireEntityChanges(projection.timings, (timing) => {
    try {
      const normalized = normalizeTurnTimingRecord(timing);
      return (
        Object.keys(normalized).length === Object.keys(timing).length &&
        Object.entries(normalized).every(([key, value]) => timing[key] === value)
      );
    } catch (error) {
      if (error.code !== SESSION_ERROR_CODE.TURN_TIMING_INVALID) throw error;
      return false;
    }
  });
  return projection;
}

export function decideSessionMutationApplication({
  projection,
  sessionId,
  appliedGeneration,
  knownGeneration,
  currentGeneration,
}) {
  requireSessionMutationProjection(projection, { sessionId });
  const validGeneration = (value) => Number.isSafeInteger(value) && value >= 1;
  if (
    (knownGeneration !== null && !validGeneration(knownGeneration)) ||
    !validGeneration(currentGeneration) ||
    (appliedGeneration !== null && !validGeneration(appliedGeneration)) ||
    (appliedGeneration !== null &&
      (knownGeneration === null || appliedGeneration > knownGeneration)) ||
    currentGeneration < projection.generation
  )
    fail("invalid_application_generations");
  const requiredGeneration =
    knownGeneration === null ? currentGeneration : Math.max(knownGeneration, currentGeneration);
  if (appliedGeneration !== null && appliedGeneration >= requiredGeneration)
    return Object.freeze({ action: "unchanged", requiredGeneration });
  return Object.freeze({ action: "synchronize", requiredGeneration });
}
