/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean } from "../normalize.js";
import { validateTurnReplacementCommit } from "../lifecycle/turn-replacement.js";
import { SESSION_COMMAND } from "./session-command.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalText(value) {
  return typeof value === "string" && Boolean(value) && value === clean(value);
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function collectUnknownFieldErrors(result, allowedKeys, errors) {
  if (Object.keys(result).some((key) => !allowedKeys.includes(key))) {
    errors.push("unknown_command_result_field");
  }
}

function validateMessageUidResult(result, errors) {
  if (!clean(result.messageUid)) errors.push("missing_result_message_uid");
  collectUnknownFieldErrors(result, ["messageUid"], errors);
  if (result.messageUid !== clean(result.messageUid)) {
    errors.push("non_canonical_result_message_uid");
  }
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

function normalizeCommandResult(type, result) {
  if (!isPlainObject(result)) return null;
  if (type === SESSION_COMMAND.TURN_COMMIT || type === SESSION_COMMAND.TURN_ATTACHMENTS_BIND) {
    const messageUid = clean(result.messageUid);
    return messageUid ? { messageUid } : {};
  }
  return structuredClone(result);
}

export function validateCommandReceiptResult(type, result) {
  const validate = COMMAND_RESULT_VALIDATORS[type];
  if (!validate) return Object.freeze({ valid: true, errors: Object.freeze([]) });
  const errors = [];
  if (isPlainObject(result)) validate(result, errors);
  else errors.push("invalid_command_result");
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function normalizeCommandReceipt(receipt = {}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return null;
  const commandId = clean(receipt.commandId);
  const type = clean(receipt.type);
  const requestHash = clean(receipt.requestHash);
  if (!commandId || !type || !requestHash) return null;
  const aggregateVersion = Number(receipt.aggregateVersion || 0);
  if (!Number.isSafeInteger(aggregateVersion) || aggregateVersion < 0) return null;
  for (const field of ["revision", "sequence"]) {
    if (
      receipt[field] !== undefined &&
      (!Number.isSafeInteger(Number(receipt[field])) || Number(receipt[field]) < 0)
    ) {
      return null;
    }
  }
  const result = normalizeCommandResult(type, receipt.result);
  return {
    commandId,
    type,
    requestHash,
    aggregateVersion,
    committedAt: clean(receipt.committedAt),
    ...(clean(receipt.turnScopeId) ? { turnScopeId: clean(receipt.turnScopeId) } : {}),
    ...(result ? { result } : {}),
    ...(Number.isInteger(Number(receipt.revision)) ? { revision: Number(receipt.revision) } : {}),
    ...(Number.isInteger(Number(receipt.sequence)) ? { sequence: Number(receipt.sequence) } : {}),
    ...(clean(receipt.eventId) ? { eventId: clean(receipt.eventId) } : {}),
    ...(receipt.envelope && typeof receipt.envelope === "object" && !Array.isArray(receipt.envelope)
      ? { envelope: structuredClone(receipt.envelope) }
      : {}),
  };
}
export function normalizeCommandReceipts(receipts = []) {
  if (!Array.isArray(receipts)) throw new TypeError("command receipts must be an array");
  const normalized = receipts.map(normalizeCommandReceipt);
  if (normalized.some((receipt) => !receipt)) throw new TypeError("invalid command receipt");
  return normalized.slice(-200);
}
export function decideCommandIdempotency({ commandId, type, requestHash, receipts = [] } = {}) {
  const id = clean(commandId);
  const commandType = clean(type);
  const hash = clean(requestHash);
  if (!id || !commandType || !hash)
    return Object.freeze({ allowed: false, reason: "invalid_command_identity" });
  const receipt = normalizeCommandReceipts(receipts).find((item) => item.commandId === id);
  if (!receipt) return Object.freeze({ allowed: true, deduplicated: false });
  if (receipt.type !== commandType || receipt.requestHash !== hash)
    return Object.freeze({ allowed: false, reason: "command_id_reuse_conflict" });
  return Object.freeze({ allowed: true, deduplicated: true, receipt });
}
export function appendCommandReceipt(receipts = [], receipt = {}) {
  if (!validateCommandReceiptResult(clean(receipt?.type), receipt?.result).valid) {
    throw new TypeError("invalid command receipt result");
  }
  const normalized = normalizeCommandReceipt(receipt);
  if (!normalized) throw new TypeError("invalid command receipt");
  const decision = decideCommandIdempotency({ ...normalized, receipts });
  if (!decision.allowed) throw new TypeError(decision.reason);
  return decision.deduplicated
    ? normalizeCommandReceipts(receipts)
    : normalizeCommandReceipts([...receipts, normalized]);
}
