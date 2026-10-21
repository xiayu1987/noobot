/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";
import { MESSAGE_IDENTITY_FIELD } from "../identity/message-identity.js";

export const SESSION_AUTO_TITLE_MAX_LENGTH = 20;

const ROLE_IDENTITY_FIELD = Object.freeze({
  assistant: MESSAGE_IDENTITY_FIELD.MODEL,
  user: MESSAGE_IDENTITY_FIELD.USER,
});
const ROLE_IDENTITY_FIELDS = Object.freeze(Object.values(ROLE_IDENTITY_FIELD));

export function resolveSessionMessageRecordModelMessageId(record = {}) {
  return text(record?.role) === "assistant" ? text(record?.[MESSAGE_IDENTITY_FIELD.MODEL]) : "";
}

export function resolveSessionMessageRecordUserMessageId(record = {}) {
  return text(record?.role) === "user" ? text(record?.[MESSAGE_IDENTITY_FIELD.USER]) : "";
}

export function validateSessionMessageRecordIdentity(record = {}) {
  const errors = [];
  if (!text(record?.[MESSAGE_IDENTITY_FIELD.SESSION])) errors.push("session_message_uid_missing");
  if (Object.hasOwn(record ?? {}, "messageId")) errors.push("session_message_id_noncanonical");
  const role = text(record?.role);
  const ownField = ROLE_IDENTITY_FIELD[role] || "";
  for (const field of ROLE_IDENTITY_FIELDS) {
    if (field !== ownField && Object.hasOwn(record ?? {}, field)) {
      errors.push(`session_message_${field}_forbidden_for_${role || "unknown"}`);
    }
  }
  if (role === "assistant" && !resolveSessionMessageRecordModelMessageId(record)) {
    errors.push("session_message_model_message_id_missing");
  }
  return errors;
}

export function assertSessionMessageRecordIdentity(record = {}) {
  const errors = validateSessionMessageRecordIdentity(record);
  if (!errors.length) return record;
  const error = new TypeError(`invalid session message identity: ${errors.join(",")}`);
  error.code = "SESSION_MESSAGE_IDENTITY_INVALID";
  error.validationErrors = errors;
  throw error;
}

export function isSummarizedSessionMessageRecord(record = {}) {
  return record?.summarized === true;
}

export function isInjectedSessionMessageRecord(record = {}) {
  return record?.injectedMessage === true;
}

export function isPluginSessionMessageRecord(record = {}) {
  return record?.pluginMessage === true;
}

export function isInjectedOrPluginSessionMessageRecord(record = {}) {
  return isInjectedSessionMessageRecord(record) || isPluginSessionMessageRecord(record);
}

export function resolveSessionMessageRecordDialogProcessId(record = {}) {
  return text(record?.dialogProcessId);
}

export function resolveSessionMessageRecordInjectedType(record = {}) {
  return isInjectedSessionMessageRecord(record) ? text(record?.injectedMessageType) : "";
}

export function resolveSessionMessageRecordInternalMessageType(record = {}) {
  return text(record?.noobotInternalMessageType);
}

export function isDialogAnchorMessageRecord(record = {}) {
  if (text(record?.role) !== "user") return false;
  if (isInjectedOrPluginSessionMessageRecord(record)) return false;
  return text(record?.messageOrigin).toLowerCase() !== "internal";
}

export function resolveSessionAutoTitle(record = {}) {
  if (isInjectedSessionMessageRecord(record)) return "";
  if (text(record?.role).toLowerCase() !== "user") return "";
  if (!text(record?.content)) return "";
  return String(record.content).slice(0, SESSION_AUTO_TITLE_MAX_LENGTH);
}

export function deriveSessionAutoTitle(records = []) {
  for (const record of Array.isArray(records) ? records : []) {
    const title = resolveSessionAutoTitle(record);
    if (title) return title;
  }
  return "";
}
