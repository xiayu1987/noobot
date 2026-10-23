/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { validateTurnReplacementCommit } from "../lifecycle/turn-replacement.js";
import { TURN_EVENT_VALUES } from "../lifecycle/turn-event.js";
import { SESSION_COMMAND, isSessionAggregateVersion } from "./session-command.js";
import { SESSION_ERROR_CODE } from "../errors.js";

const SESSION_COMMAND_TYPES = new Set(Object.values(SESSION_COMMAND));
const TURN_EVENT_TYPES = new Set(TURN_EVENT_VALUES);

function invalidCommandReceipt() {
  return Object.assign(new TypeError("invalid command receipt"), {
    code: SESSION_ERROR_CODE.COMMAND_RECEIPT_INVALID,
  });
}
const SESSION_RECEIPT_KEYS = new Set([
  "commandId",
  "type",
  "requestHash",
  "aggregateVersion",
  "committedAt",
  "turnScopeId",
  "result",
]);
const TURN_RECEIPT_KEYS = new Set([
  "commandId",
  "type",
  "requestHash",
  "committedAt",
  "turnScopeId",
  "revision",
  "sequence",
  "eventId",
  "envelope",
]);
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function collectUnknownFieldErrors(result, allowedKeys, errors) {
  if (Object.keys(result).some((key) => !allowedKeys.includes(key))) {
    errors.push("unknown_command_result_field");
  }
}

function validateMessageUidResult(result, errors) {
  if (!isCanonicalText(result.messageUid)) errors.push("invalid_result_message_uid");
  collectUnknownFieldErrors(result, ["messageUid"], errors);
}

function validateMessageDeleteResult(result, errors) {
  collectUnknownFieldErrors(result, ["deletedCount", "anchorIndex", "deletedTurnScopeIds"], errors);
  if (!isNonNegativeInteger(result.deletedCount)) errors.push("invalid_result_deleted_count");
  if (!isNonNegativeInteger(result.anchorIndex)) errors.push("invalid_result_anchor_index");
  if (
    !Array.isArray(result.deletedTurnScopeIds) ||
    !result.deletedTurnScopeIds.every(isCanonicalText)
  ) {
    errors.push("invalid_result_deleted_turn_scope_ids");
  }
}

function validateTurnReplaceResult(result, errors) {
  collectUnknownFieldErrors(result, ["turnReplacement"], errors);
  if (!validateTurnReplacementCommit(result.turnReplacement).valid) {
    errors.push("invalid_result_turn_replacement");
  }
}

const COMMAND_RESULT_VALIDATORS = Object.freeze({
  [SESSION_COMMAND.TURN_COMMIT]: validateMessageUidResult,
  [SESSION_COMMAND.TURN_ATTACHMENTS_BIND]: validateMessageUidResult,
  [SESSION_COMMAND.MESSAGE_DELETE_FROM]: validateMessageDeleteResult,
  [SESSION_COMMAND.TURN_REPLACE]: validateTurnReplaceResult,
});

export function validateCommandReceiptResult(type, result) {
  const validate = COMMAND_RESULT_VALIDATORS[type];
  if (!validate) return Object.freeze({ valid: true, errors: Object.freeze([]) });
  const errors = [];
  if (isPlainObject(result)) validate(result, errors);
  else errors.push("invalid_command_result");
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function hasOnlyKeys(receipt, allowedKeys) {
  return Object.keys(receipt).every((key) => allowedKeys.has(key));
}

function isOptionalCanonicalText(receipt, field) {
  return !Object.hasOwn(receipt, field) || isCanonicalText(receipt[field]);
}

function isCanonicalSessionReceipt(receipt) {
  return (
    hasOnlyKeys(receipt, SESSION_RECEIPT_KEYS) &&
    isSessionAggregateVersion(receipt.aggregateVersion) &&
    validateCommandReceiptResult(receipt.type, receipt.result).valid
  );
}

function isCanonicalTurnReceipt(receipt) {
  return (
    hasOnlyKeys(receipt, TURN_RECEIPT_KEYS) &&
    isNonNegativeInteger(receipt.revision) &&
    isNonNegativeInteger(receipt.sequence) &&
    isCanonicalText(receipt.eventId) &&
    isPlainObject(receipt.envelope) &&
    receipt.envelope.identity?.eventId === receipt.eventId
  );
}

export function normalizeCommandReceipt(receipt) {
  if (!isPlainObject(receipt)) return null;
  if (
    !isCanonicalText(receipt.commandId) ||
    !isCanonicalText(receipt.requestHash) ||
    !isCanonicalText(receipt.committedAt) ||
    !isOptionalCanonicalText(receipt, "turnScopeId")
  ) {
    return null;
  }
  if (SESSION_COMMAND_TYPES.has(receipt.type)) {
    return isCanonicalSessionReceipt(receipt) ? structuredClone(receipt) : null;
  }
  if (TURN_EVENT_TYPES.has(receipt.type)) {
    return isCanonicalTurnReceipt(receipt) ? structuredClone(receipt) : null;
  }
  return null;
}
export function normalizeCommandReceipts(receipts = []) {
  if (!Array.isArray(receipts)) throw new TypeError("command receipts must be an array");
  const normalized = receipts.map(normalizeCommandReceipt);
  if (normalized.some((receipt) => !receipt)) throw invalidCommandReceipt();
  return normalized.slice(-200);
}
export function decideCommandIdempotency({ commandId, type, requestHash, receipts = [] } = {}) {
  if (!isCanonicalText(commandId) || !isCanonicalText(type) || !isCanonicalText(requestHash))
    return Object.freeze({ allowed: false, reason: "invalid_command_identity" });
  const receipt = normalizeCommandReceipts(receipts).find((item) => item.commandId === commandId);
  if (!receipt) return Object.freeze({ allowed: true, deduplicated: false });
  if (receipt.type !== type || receipt.requestHash !== requestHash)
    return Object.freeze({ allowed: false, reason: "command_id_reuse_conflict" });
  return Object.freeze({ allowed: true, deduplicated: true, receipt });
}
export function appendCommandReceipt(receipts, receipt) {
  const normalized = normalizeCommandReceipt(receipt);
  if (!normalized) throw invalidCommandReceipt();
  const decision = decideCommandIdempotency({ ...normalized, receipts });
  if (!decision.allowed) throw new TypeError(decision.reason);
  return decision.deduplicated
    ? normalizeCommandReceipts(receipts)
    : normalizeCommandReceipts([...receipts, normalized]);
}
