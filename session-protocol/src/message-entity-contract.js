/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MESSAGE_ORIGIN = Object.freeze({
  NATURAL: "natural",
  INTERNAL: "internal",
});

const MESSAGE_ORIGIN_VALUES = new Set(Object.values(MESSAGE_ORIGIN));

export const SESSION_MESSAGE_ENTITY_INVALID = "SESSION_MESSAGE_ENTITY_INVALID";

export function isMessageOrigin(value) {
  return MESSAGE_ORIGIN_VALUES.has(value);
}

export function isDialogUserMessageRecord(record) {
  return record.role === "user" && record.injectedMessage !== true && record.pluginMessage !== true;
}

export function isCanonicalMessageTimestamp(value) {
  if (typeof value !== "string") return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value;
}

export function collectSessionMessageEntityErrors(record) {
  const errors = [];
  if (typeof record.content !== "string") errors.push("content_not_string");
  if (!Array.isArray(record.attachments)) errors.push("attachments_not_array");
  if (!isCanonicalMessageTimestamp(record.ts)) errors.push("ts_not_canonical_iso");
  if (isDialogUserMessageRecord(record)) {
    if (!isMessageOrigin(record.messageOrigin)) errors.push("message_origin_required");
  } else if (Object.hasOwn(record, "messageOrigin")) {
    errors.push("message_origin_forbidden");
  }
  return errors;
}

export function assertSessionMessageEntity(record) {
  const errors = collectSessionMessageEntityErrors(record);
  if (!errors.length) return record;
  const error = new TypeError(`invalid Session message entity: ${errors.join(",")}`);
  error.code = SESSION_MESSAGE_ENTITY_INVALID;
  error.validationErrors = errors;
  throw error;
}

export function pickMessageOriginField(source) {
  return Object.hasOwn(source, "messageOrigin") ? { messageOrigin: source.messageOrigin } : {};
}

export function isInternalDialogUserMessage(record) {
  return isDialogUserMessageRecord(record) && record.messageOrigin === MESSAGE_ORIGIN.INTERNAL;
}

export function isNaturalDialogUserMessage(record) {
  return isDialogUserMessageRecord(record) && record.messageOrigin === MESSAGE_ORIGIN.NATURAL;
}
