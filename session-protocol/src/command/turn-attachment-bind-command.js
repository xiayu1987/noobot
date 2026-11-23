/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject, text as clean } from "@noobot/shared/value";
import { canonicalAttachmentIdentities, createCommandRequestHash } from "./command-fingerprint.js";
import {
  appendCommandReceipt,
  decideCommandIdempotency,
  isCanonicalCommandReceipt,
} from "./command-receipt.js";
import {
  createAggregateVersionConflictError,
  decideAggregateConcurrency,
  requireSessionAggregateVersion,
  SESSION_COMMAND,
} from "./session-command.js";
import { SESSION_ERROR_CODE } from "../errors.js";

export function createTurnAttachmentBindFingerprint({
  turnScopeId = "",
  messageUid = "",
  attachments,
} = {}) {
  return createCommandRequestHash({
    type: SESSION_COMMAND.TURN_ATTACHMENTS_BIND,
    turnScopeId: clean(turnScopeId),
    messageUid: clean(messageUid),
    attachments: canonicalAttachmentIdentities(attachments),
  });
}

export function checkAttachmentBindingCommand({ identity, requestHash }, receipt) {
  const decision = decideCommandIdempotency({
    commandId: identity.commandId,
    type: SESSION_COMMAND.TURN_ATTACHMENTS_BIND,
    requestHash,
    receipts: receipt ? [receipt] : [],
  });
  if (!decision.allowed)
    throw Object.assign(new Error("commandId was reused with a different request"), {
      statusCode: 409,
      code: SESSION_ERROR_CODE.IDEMPOTENCY_KEY_REUSED,
    });
  return decision.deduplicated;
}

export function requireAttachmentBindingTarget(message, turnScopeId) {
  if (!message || message.turnScopeId !== turnScopeId || message.role !== "user")
    throw Object.assign(new Error("Turn user message not found"), {
      statusCode: 404,
      code: "SESSION_MESSAGE_NOT_FOUND",
    });
}

export function matchesAttachmentBindingReceipt(receipt, commandId, message) {
  return (
    isCanonicalCommandReceipt(receipt) &&
    receipt.type === SESSION_COMMAND.TURN_ATTACHMENTS_BIND &&
    receipt.commandId === commandId &&
    message?.role === "user" &&
    receipt.turnScopeId === message.turnScopeId &&
    receipt.result.messageUid === message.messageUid
  );
}

export function attachmentBindingResult(messageUid, aggregateVersion, deduplicated) {
  return requireAttachmentBindingResult({ messageUid, aggregateVersion, deduplicated });
}

export function requireAttachmentBindingResult(result) {
  if (
    !isPlainObject(result) ||
    Object.keys(result).length !== 3 ||
    !isCanonicalText(result.messageUid) ||
    typeof result.deduplicated !== "boolean"
  )
    throw new TypeError("Invalid attachment binding result");
  requireSessionAggregateVersion(result.aggregateVersion);
  return result;
}

export function requireAttachmentBindingResponse(response) {
  if (!isPlainObject(response)) throw new TypeError("Invalid attachment binding response");
  const { attachments, ...result } = response;
  requireAttachmentBindingResult(result);
  if (!Array.isArray(attachments) || attachments.length === 0)
    throw new TypeError("Attachment binding response requires committed attachments");
  return response;
}

export function createAttachmentBindingReceipt(
  { identity, requestHash, normalizedExpectedVersion },
  { aggregateVersion, alreadyBound, hasAttachments, committedAt },
) {
  if (alreadyBound) throw alreadyBoundError();
  const concurrency = decideAggregateConcurrency({
    expectedAggregateVersion: normalizedExpectedVersion,
    aggregateVersion,
  });
  if (!concurrency.allowed)
    throw createAggregateVersionConflictError({ currentVersion: aggregateVersion });
  if (hasAttachments) throw alreadyBoundError();
  const [receipt] = appendCommandReceipt([], {
    commandId: identity.commandId,
    type: SESSION_COMMAND.TURN_ATTACHMENTS_BIND,
    turnScopeId: identity.turnScopeId,
    requestHash,
    aggregateVersion: concurrency.nextAggregateVersion,
    result: { messageUid: identity.messageUid },
    committedAt,
  });
  return receipt;
}

function alreadyBoundError() {
  return Object.assign(new Error("Turn attachments are already bound"), {
    statusCode: 409,
    code: SESSION_ERROR_CODE.TURN_ATTACHMENTS_ALREADY_BOUND,
  });
}
