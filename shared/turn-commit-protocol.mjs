/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const trim = (value = "") => String(value || "").trim();

export function validateTurnCommittedEventData(data = {}) {
  const errors = [];
  const sessionId = trim(data?.sessionId);
  const dialogProcessId = trim(data?.dialogProcessId);
  const turnScopeId = trim(data?.turnScopeId);
  const aggregateVersion = Number(data?.aggregateVersion);
  const userMessage = data?.userMessage;

  if (!sessionId) errors.push("session_id_missing");
  if (!dialogProcessId) errors.push("dialog_process_id_missing");
  if (!turnScopeId) errors.push("turn_scope_id_missing");
  if (!Number.isInteger(aggregateVersion) || aggregateVersion < 1) {
    errors.push("aggregate_version_invalid");
  }
  if (!userMessage || typeof userMessage !== "object" || Array.isArray(userMessage)) {
    errors.push("user_message_missing");
    return { ok: false, errors };
  }
  if (trim(userMessage.role) !== "user") errors.push("user_message_role_invalid");
  if (!trim(userMessage.messageUid)) errors.push("user_message_uid_missing");
  if (!trim(userMessage.messageId)) errors.push("user_message_id_missing");
  if (trim(userMessage.sessionId) !== sessionId) errors.push("user_message_session_mismatch");
  if (trim(userMessage.dialogProcessId) !== dialogProcessId) {
    errors.push("user_message_dialog_mismatch");
  }
  if (trim(userMessage.turnScopeId) !== turnScopeId) errors.push("user_message_turn_mismatch");

  const attachments = userMessage.attachments;
  if (attachments !== undefined && !Array.isArray(attachments)) {
    errors.push("user_message_attachments_invalid");
  }
  for (const attachment of Array.isArray(attachments) ? attachments : []) {
    if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
      errors.push("attachment_invalid");
      continue;
    }
    if (!trim(attachment.attachmentId)) errors.push("attachment_id_missing");
    if (trim(attachment.sessionId) !== sessionId) errors.push("attachment_session_mismatch");
  }
  return { ok: errors.length === 0, errors };
}

export function assertTurnCommittedEventData(data = {}) {
  const validation = validateTurnCommittedEventData(data);
  if (validation.ok) return data;
  const error = new TypeError(`invalid turn_committed event: ${validation.errors.join(",")}`);
  error.code = "TURN_COMMITTED_PROTOCOL_INVALID";
  error.validationErrors = validation.errors;
  throw error;
}
