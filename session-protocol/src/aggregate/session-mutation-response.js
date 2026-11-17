/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { SESSION_ERROR_CODE } from "../errors.js";
import { SESSION_COMMAND, isSessionAggregateVersion } from "../command/session-command.js";
import { validateCommandReceiptResult } from "../command/command-receipt.js";
import { requireSessionMutationProjection } from "./session-mutation-projection.js";

const ENVELOPE_FIELDS = Object.freeze([
  "commandId",
  "committedAggregateVersion",
  "deduplicated",
  "deletedMessageUids",
  "sessionId",
  "generation",
  "projection",
  "displayMessages",
]);
const MESSAGE_DELETE_RESULT_FIELDS = Object.freeze([
  "deletedCount",
  "anchorIndex",
  "deletedTurnScopeIds",
]);
const TURN_REPLACE_RESULT_FIELDS = Object.freeze(["turnReplacement"]);
const MESSAGE_DELETE_RESPONSE_FIELDS = Object.freeze([
  ...MESSAGE_DELETE_RESULT_FIELDS,
  ...ENVELOPE_FIELDS,
]);
const TURN_REPLACE_RESPONSE_FIELDS = Object.freeze([
  ...TURN_REPLACE_RESULT_FIELDS,
  ...ENVELOPE_FIELDS,
]);

function responseInvalid(errors) {
  return Object.assign(new TypeError(`session mutation response is invalid: ${errors.join(",")}`), {
    code: SESSION_ERROR_CODE.SESSION_MUTATION_RESPONSE_INVALID,
    validationErrors: errors,
  });
}

function collectFieldErrors(response, fields) {
  const errors = [];
  for (const field of fields) {
    if (!Object.hasOwn(response, field)) errors.push(`missing_${field}`);
  }
  for (const key of Object.keys(response)) {
    if (!fields.includes(key)) errors.push(`unexpected_${key}`);
  }
  return errors;
}

function pickFields(response, fields) {
  return Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(response, field))
      .map((field) => [field, response[field]]),
  );
}

function collectEnvelopeErrors(response) {
  const errors = [];
  if (!isCanonicalText(response.commandId)) errors.push("invalid_command_id");
  if (!isSessionAggregateVersion(response.committedAggregateVersion)) {
    errors.push("invalid_committed_aggregate_version");
  }
  if (typeof response.deduplicated !== "boolean") errors.push("invalid_deduplicated");
  return errors;
}

function readProjection(response) {
  try {
    requireSessionMutationProjection(response.projection, { sessionId: response.sessionId });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return { errors: ["invalid_projection"], main: null };
  }
  const { projection, generation, displayMessages } = response;
  const errors = [];
  if (!Number.isSafeInteger(generation) || generation < projection.generation)
    errors.push("invalid_generation");
  if (!response.deduplicated && generation !== projection.generation)
    errors.push("new_commit_generation_mismatch");
  const receipt = projection.receipt;
  if (
    receipt.commandId !== response.commandId ||
    receipt.aggregateVersion !== response.committedAggregateVersion
  )
    errors.push("projection_receipt_mismatch");
  const result = Object.hasOwn(response, "turnReplacement")
    ? { turnReplacement: response.turnReplacement }
    : pickFields(response, MESSAGE_DELETE_RESULT_FIELDS);
  if (JSON.stringify(result) !== JSON.stringify(receipt.result))
    errors.push("projection_result_mismatch");
  if (!Array.isArray(displayMessages))
    return { errors: [...errors, "invalid_display_messages"], main: null };
  if (projection.kind === "baseline") {
    if (!response.deduplicated || response.deletedMessageUids !== null || displayMessages.length)
      errors.push("invalid_baseline_effect");
    return { errors, main: null };
  }
  if (JSON.stringify(response.deletedMessageUids) !== JSON.stringify(projection.deletedMessageUids))
    errors.push("projection_deletion_mismatch");

  if (
    displayMessages.length !== projection.messages.length ||
    displayMessages.some((message, index) => {
      const source = projection.messages[index].message;
      return (
        !isPlainObject(message) ||
        message.role !== "user" ||
        message.messageUid !== source.messageUid ||
        message.turnScopeId !== source.turnScopeId ||
        message.dialogProcessId !== source.dialogProcessId ||
        message.content !== source.content
      );
    })
  )
    errors.push("display_effect_mismatch");
  return { errors, main: errors.length ? null : { messages: displayMessages } };
}

function collectMessageDeletionErrors(response, main) {
  const uids = response.deletedMessageUids;
  if (uids === null) return response.deduplicated === true ? [] : ["missing_deletion_evidence"];
  if (
    !Array.isArray(uids) ||
    uids.some((uid) => !isCanonicalText(uid)) ||
    new Set(uids).size !== uids.length
  )
    return ["invalid_deleted_message_uids"];
  const errors = [];
  if (Object.hasOwn(response, "deletedCount") && uids.length !== response.deletedCount)
    errors.push("deleted_message_count_mismatch");
  if (!response.deduplicated && main) {
    const removed = new Set(uids);
    if (main.messages.some((message) => removed.has(message.messageUid)))
      errors.push("deleted_message_still_materialized");
  }
  return errors;
}

function collectReplacementMaterializationErrors(commit, messages, deduplicated) {
  const errors = [];
  const users = messages.filter(
    (message) => message.messageUid === commit.replacementUserMessageUid,
  );
  if (users.length !== 1 || users[0].role !== "user") {
    errors.push("replacement_user_missing");
  } else {
    if (users[0].turnScopeId !== commit.replacementTurnScopeId) {
      errors.push("replacement_scope_mismatch");
    }
    if (users[0].dialogProcessId !== commit.replacementDialogProcessId) {
      errors.push("replacement_dialog_process_mismatch");
    }
  }
  if (
    !deduplicated &&
    messages.filter((message) => message.turnScopeId === commit.replacementTurnScopeId).length !== 1
  ) {
    errors.push("replacement_scope_not_user_only");
  }
  return errors;
}

function collectMessageDeleteErrors(response) {
  if (!isPlainObject(response)) return ["response_not_object"];
  const errors = [
    ...collectFieldErrors(response, MESSAGE_DELETE_RESPONSE_FIELDS),
    ...validateCommandReceiptResult(
      SESSION_COMMAND.MESSAGE_DELETE_FROM,
      pickFields(response, MESSAGE_DELETE_RESULT_FIELDS),
    ).errors,
    ...collectEnvelopeErrors(response),
  ];
  const detail = readProjection(response);
  errors.push(...detail.errors);
  errors.push(...collectMessageDeletionErrors(response, detail.main));
  return errors;
}

function collectTurnReplaceErrors(response) {
  if (!isPlainObject(response)) return ["response_not_object"];
  const receiptErrors = validateCommandReceiptResult(
    SESSION_COMMAND.TURN_REPLACE,
    pickFields(response, TURN_REPLACE_RESULT_FIELDS),
  ).errors;
  const errors = [
    ...collectFieldErrors(response, TURN_REPLACE_RESPONSE_FIELDS),
    ...receiptErrors,
    ...collectEnvelopeErrors(response),
  ];
  const detail = readProjection(response);
  errors.push(...detail.errors);
  errors.push(...collectMessageDeletionErrors(response, detail.main));
  if (receiptErrors.length) return errors;
  const commit = response.turnReplacement;
  if (commit.commandId !== response.commandId) errors.push("command_id_mismatch");
  if (commit.committedAggregateVersion !== response.committedAggregateVersion) {
    errors.push("committed_aggregate_version_mismatch");
  }
  if (response.sessionId !== commit.sessionId) {
    errors.push("session_identity_mismatch");
  }
  if (detail.main) {
    errors.push(
      ...collectReplacementMaterializationErrors(
        commit,
        detail.main.messages,
        response.deduplicated === true,
      ),
    );
  }
  return errors;
}

export function requireMessageDeleteResponse(response) {
  const errors = collectMessageDeleteErrors(response);
  if (errors.length) throw responseInvalid(errors);
  return response;
}

export function requireTurnReplaceResponse(response) {
  const errors = collectTurnReplaceErrors(response);
  if (errors.length) throw responseInvalid(errors);
  return response;
}

export function createMessageDeleteResponse({
  receiptResult,
  commandId,
  committedAggregateVersion,
  deduplicated,
  deletedMessageUids,
  sessionId,
  generation,
  projection,
  displayMessages,
}) {
  return requireMessageDeleteResponse(
    Object.freeze({
      ...receiptResult,
      commandId,
      committedAggregateVersion,
      deduplicated,
      deletedMessageUids,
      sessionId,
      generation,
      projection,
      displayMessages,
    }),
  );
}

export function createTurnReplaceResponse({
  receiptResult,
  commandId,
  committedAggregateVersion,
  deduplicated,
  deletedMessageUids,
  sessionId,
  generation,
  projection,
  displayMessages,
}) {
  return requireTurnReplaceResponse(
    Object.freeze({
      ...receiptResult,
      commandId,
      committedAggregateVersion,
      deduplicated,
      deletedMessageUids,
      sessionId,
      generation,
      projection,
      displayMessages,
    }),
  );
}
