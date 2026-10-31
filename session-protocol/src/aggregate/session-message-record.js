/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject, text } from "@noobot/shared/value";
import { MESSAGE_IDENTITY_FIELD } from "../identity/message-identity.js";
import { isNaturalDialogUserMessage } from "../message-entity-contract.js";
import {
  MESSAGE_RECORD_REMOVED_FIELDS,
  judgeMessageFieldRemoval,
  messageFieldRemovalsFor,
  messageFieldRenamesFor,
  messageRecordIdentityFieldsFor,
} from "../identity/message-identity-schema.js";

export const SESSION_AUTO_TITLE_MAX_LENGTH = 20;

export function resolveSessionMessageRecordModelMessageId(record = {}) {
  return text(record?.role) === "assistant" ? text(record?.[MESSAGE_IDENTITY_FIELD.MODEL]) : "";
}

export function resolveSessionMessageRecordUserMessageId(record = {}) {
  return text(record?.role) === "user" ? text(record?.[MESSAGE_IDENTITY_FIELD.USER]) : "";
}

export function validateSessionMessageRecordIdentity(record = {}) {
  const errors = [];
  if (!text(record?.[MESSAGE_IDENTITY_FIELD.SESSION])) errors.push("session_message_uid_missing");
  if (!isCanonicalText(record?.sessionId)) errors.push("session_message_session_id_missing");
  for (const field of MESSAGE_RECORD_REMOVED_FIELDS) {
    if (Object.hasOwn(record ?? {}, field)) errors.push(`session_message_${field}_removed`);
  }
  const role = text(record?.role);
  const fields = messageRecordIdentityFieldsFor(role);
  for (const field of fields.forbidden) {
    if (Object.hasOwn(record ?? {}, field)) {
      errors.push(`session_message_${field}_forbidden_for_${role || "unknown"}`);
    }
  }
  for (const field of fields.required) {
    if (!text(record?.[field])) errors.push(`session_message_${field}_missing`);
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

export const SESSION_MESSAGE_RECORD_MIGRATION_INVALID = "SESSION_MESSAGE_RECORD_MIGRATION_INVALID";

function recordMigrationError(reason, field) {
  const error = new TypeError(`session message record migration rejected: ${reason}:${field}`);
  error.code = SESSION_MESSAGE_RECORD_MIGRATION_INVALID;
  error.details = { reason, field };
  return error;
}

function roleMatches(entry, role) {
  return entry.roles === null || entry.roles.includes(role);
}

function duplicates(source, value, duplicateOf) {
  return duplicateOf !== null && duplicateOf.some((field) => source[field] === value);
}

function applyRecordRename(source, next, rename) {
  if (!Object.hasOwn(source, rename.from)) return false;
  if (!roleMatches(rename, source.role)) return false;
  const value = source[rename.from];
  delete next[rename.from];
  if (duplicates(source, value, rename.duplicateOf)) return true;
  if (Object.hasOwn(source, rename.to) && source[rename.to] !== value) {
    throw recordMigrationError("rename_conflict", rename.from);
  }
  next[rename.to] = value;
  return true;
}

function applyRecordRemoval(source, next, removal) {
  const judgment = judgeMessageFieldRemoval(source, text(source.role), removal);
  if (judgment.rejection) throw recordMigrationError(judgment.rejection, removal.field);
  if (!judgment.remove) return false;
  delete next[removal.field];
  return true;
}

export function migrateSessionMessageRecordIdentity(record, store) {
  if (!isPlainObject(record)) {
    throw recordMigrationError("record_not_object", "record");
  }
  const next = { ...record };
  const handled = new Set();
  for (const rename of messageFieldRenamesFor(store)) {
    if (applyRecordRename(record, next, rename)) handled.add(rename.from);
  }
  for (const removal of messageFieldRemovalsFor(store)) {
    if (handled.has(removal.field)) continue;
    if (applyRecordRemoval(record, next, removal)) handled.add(removal.field);
  }
  return { record: next, changed: handled.size > 0 };
}

export function projectSessionMessageRecordIdentity(record = {}) {
  const identity = {};
  const messageUid = text(record?.[MESSAGE_IDENTITY_FIELD.SESSION]);
  if (messageUid) identity[MESSAGE_IDENTITY_FIELD.SESSION] = messageUid;
  for (const field of messageRecordIdentityFieldsFor(text(record?.role)).allowed) {
    const value = text(record?.[field]);
    if (value) identity[field] = value;
  }
  return identity;
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
  return isNaturalDialogUserMessage(record);
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
