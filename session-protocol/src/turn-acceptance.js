/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text, isPlainObject } from "@noobot/shared/value";
import { TURN_EVENT } from "./lifecycle/turn-event.js";
import { TURN_ACTION } from "./lifecycle/turn-action.js";
import { acceptedMessageIdentityFieldsFor } from "./identity/message-identity-schema.js";

const ACCEPTED_USER_IDENTITY_FIELDS = acceptedMessageIdentityFieldsFor("user");

export function validateTurnAcceptanceUserMessage(event = {}) {
  if (text(event.eventType) !== TURN_EVENT.ACTION_ACCEPTED) {
    return { valid: true, materialize: false, value: null, errors: [] };
  }
  if (text(event.action) === TURN_ACTION.RESEND) {
    const errors = event.userMessage === undefined ? [] : ["resend_user_message_forbidden"];
    return { valid: errors.length === 0, materialize: false, value: null, errors };
  }
  const input = event.userMessage;
  const errors = [];
  if (!isPlainObject(input)) {
    errors.push("accepted_user_message_required");
  } else {
    if (!text(input.content)) errors.push("accepted_user_message_content_required");
    for (const field of ACCEPTED_USER_IDENTITY_FIELDS) {
      if (!text(input[field])) errors.push(`accepted_user_${field}_required`);
    }
    if (!text(event.turnScopeId)) errors.push("accepted_user_message_turn_scope_required");
    if (!text(event.dialogProcessId)) errors.push("accepted_user_message_dialog_required");
    const messageOrigin = text(input.messageOrigin).toLowerCase();
    if (!["natural", "internal"].includes(messageOrigin)) {
      errors.push("accepted_message_origin_required");
    }
  }
  return {
    valid: errors.length === 0,
    materialize: errors.length === 0,
    value:
      errors.length === 0
        ? {
            content: text(input.content),
            ...Object.fromEntries(
              ACCEPTED_USER_IDENTITY_FIELDS.map((field) => [field, text(input[field])]),
            ),
            parentDialogProcessId: text(input.parentDialogProcessId),
            messageOrigin: text(input.messageOrigin).toLowerCase(),
          }
        : null,
    errors,
  };
}

export function assertTurnAcceptanceUserMessage(event = {}) {
  const validation = validateTurnAcceptanceUserMessage(event);
  if (validation.valid) return validation;
  const error = new TypeError(`invalid Turn acceptance: ${validation.errors.join(",")}`);
  error.code = "TURN_ACCEPTANCE_PROTOCOL_INVALID";
  error.validationErrors = validation.errors;
  throw error;
}

export function createTurnAcceptanceReceipt({
  commandId = "",
  sessionId = "",
  turnScopeId = "",
  dialogProcessId = "",
  messageUid = "",
  aggregateVersion,
  committedEventPublished = false,
} = {}) {
  const receipt = {
    commandId: text(commandId),
    sessionId: text(sessionId),
    turnScopeId: text(turnScopeId),
    dialogProcessId: text(dialogProcessId),
    messageUid: text(messageUid),
    aggregateVersion: Number(aggregateVersion),
    committedEventPublished: committedEventPublished === true,
  };
  const errors = [];
  for (const key of ["commandId", "sessionId", "turnScopeId", "dialogProcessId", "messageUid"]) {
    if (!receipt[key]) errors.push(`${key}_missing`);
  }
  if (!Number.isInteger(receipt.aggregateVersion) || receipt.aggregateVersion < 1) {
    errors.push("aggregate_version_invalid");
  }
  if (errors.length > 0) {
    const error = new TypeError(`invalid Turn acceptance receipt: ${errors.join(",")}`);
    error.code = "TURN_ACCEPTANCE_RECEIPT_INVALID";
    error.validationErrors = errors;
    throw error;
  }
  return Object.freeze(receipt);
}
