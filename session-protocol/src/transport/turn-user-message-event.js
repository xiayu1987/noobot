/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { MESSAGE_IDENTITY_FIELD } from "../identity/message-identity.js";
import {
  MESSAGE_REMOVED_FIELD_NAME,
  acceptedMessageIdentityFieldsFor,
} from "../identity/message-identity-schema.js";

const ACCEPTED_USER_IDENTITY_FIELDS = acceptedMessageIdentityFieldsFor("user");

function validateTurnUserMessageEventData(data, { attachmentMode }) {
  const errors = [];
  if (!isPlainObject(data)) return { valid: false, errors: ["event_data_invalid"] };
  const { sessionId, dialogProcessId, turnScopeId, aggregateVersion, userMessage } = data;

  if (!isCanonicalText(sessionId)) errors.push("session_id_missing");
  if (!isCanonicalText(dialogProcessId)) errors.push("dialog_process_id_missing");
  if (!isCanonicalText(turnScopeId)) errors.push("turn_scope_id_missing");
  if (!Number.isInteger(aggregateVersion) || aggregateVersion < 1) {
    errors.push("aggregate_version_invalid");
  }
  if (!isPlainObject(userMessage)) {
    errors.push("user_message_missing");
    return { valid: false, errors };
  }
  if (userMessage.role !== "user") errors.push("user_message_role_invalid");
  if (typeof userMessage.content !== "string") errors.push("user_message_content_invalid");
  if (!isCanonicalText(userMessage[MESSAGE_IDENTITY_FIELD.SESSION]))
    errors.push("user_message_uid_missing");
  for (const field of ACCEPTED_USER_IDENTITY_FIELDS) {
    if (!isCanonicalText(userMessage[field])) errors.push(`user_message_${field}_missing`);
  }
  if (Object.hasOwn(userMessage, MESSAGE_REMOVED_FIELD_NAME.MESSAGE_ID)) {
    errors.push("user_message_id_noncanonical");
  }
  if (userMessage.sessionId !== sessionId) errors.push("user_message_session_mismatch");
  if (userMessage.dialogProcessId !== dialogProcessId) {
    errors.push("user_message_dialog_mismatch");
  }
  if (userMessage.turnScopeId !== turnScopeId) errors.push("user_message_turn_mismatch");

  const hasAttachments = Object.hasOwn(userMessage, "attachments");
  if (hasAttachments && !Array.isArray(userMessage.attachments)) {
    errors.push("user_message_attachments_invalid");
    return { valid: false, errors };
  }
  const attachmentList = hasAttachments ? userMessage.attachments : [];
  if (attachmentMode === "forbidden" && attachmentList.length > 0) {
    errors.push("user_message_attachments_forbidden");
  }
  if (attachmentMode === "required" && attachmentList.length === 0) {
    errors.push("user_message_attachments_missing");
  }
  for (const attachment of attachmentList) {
    if (!isPlainObject(attachment)) {
      errors.push("attachment_invalid");
      continue;
    }
    if (!isCanonicalText(attachment.attachmentId)) errors.push("attachment_id_missing");
    if (attachment.sessionId !== sessionId) errors.push("attachment_session_mismatch");
  }
  return { valid: errors.length === 0, errors };
}

export function createTurnUserMessageEventProtocol({ wireEvent, attachmentMode, errorCode }) {
  const validate = (data) => validateTurnUserMessageEventData(data, { attachmentMode });
  const assert = (data) => {
    const validation = validate(data);
    if (validation.valid) return data;
    const error = new TypeError(`invalid ${wireEvent} event: ${validation.errors.join(",")}`);
    error.code = errorCode;
    error.validationErrors = validation.errors;
    throw error;
  };
  return { validate, assert };
}
