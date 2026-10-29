/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { SESSION_ERROR_CODE } from "../errors.js";
import { SESSION_COMMAND, isSessionAggregateVersion } from "../command/session-command.js";
import { validateCommandReceiptResult } from "../command/command-receipt.js";
import {
  isAvailableSessionDetailEntry,
  requireSessionDetailDocument,
  selectMainSessionDetailEntry,
} from "./session-detail.js";

const ENVELOPE_FIELDS = Object.freeze([
  "commandId",
  "committedAggregateVersion",
  "deduplicated",
  "detail",
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

function readDetail(response) {
  try {
    requireSessionDetailDocument(response.detail);
  } catch (error) {
    if (error?.code !== SESSION_ERROR_CODE.SESSION_DETAIL_PAYLOAD_INVALID) throw error;
    return { errors: [`invalid_detail:${error.message}`], main: null };
  }
  if (!response.detail.exists) return { errors: ["detail_session_missing"], main: null };
  const main = selectMainSessionDetailEntry(response.detail);
  if (!isAvailableSessionDetailEntry(main)) {
    return { errors: ["detail_main_unavailable"], main: null };
  }
  const versionMismatch =
    response.deduplicated === true
      ? main.aggregateVersion < response.committedAggregateVersion
      : main.aggregateVersion !== response.committedAggregateVersion;
  return { errors: versionMismatch ? ["detail_aggregate_version_mismatch"] : [], main };
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
  if (messages.some((message) => commit.replacedTurnScopeIds.includes(message.turnScopeId))) {
    errors.push("replaced_scope_still_materialized");
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
  const detail = readDetail(response);
  errors.push(...detail.errors);
  if (
    detail.main &&
    Array.isArray(response.deletedTurnScopeIds) &&
    detail.main.messages.some((message) =>
      response.deletedTurnScopeIds.includes(message.turnScopeId),
    )
  ) {
    errors.push("deleted_scope_still_materialized");
  }
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
  const detail = readDetail(response);
  errors.push(...detail.errors);
  if (receiptErrors.length) return errors;
  const commit = response.turnReplacement;
  if (commit.commandId !== response.commandId) errors.push("command_id_mismatch");
  if (commit.committedAggregateVersion !== response.committedAggregateVersion) {
    errors.push("committed_aggregate_version_mismatch");
  }
  if (isPlainObject(response.detail) && response.detail.sessionId !== commit.sessionId) {
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
  detail,
}) {
  return requireMessageDeleteResponse(
    Object.freeze({ ...receiptResult, commandId, committedAggregateVersion, deduplicated, detail }),
  );
}

export function createTurnReplaceResponse({
  receiptResult,
  commandId,
  committedAggregateVersion,
  deduplicated,
  detail,
}) {
  return requireTurnReplaceResponse(
    Object.freeze({ ...receiptResult, commandId, committedAggregateVersion, deduplicated, detail }),
  );
}
