/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isCanonicalText } from "@noobot/shared/value";

export const MESSAGE_ORIGIN = Object.freeze({
  NATURAL: "natural",
  INTERNAL: "internal",
});

const MESSAGE_ORIGIN_VALUES = new Set(Object.values(MESSAGE_ORIGIN));

export const SESSION_MESSAGE_ENTITY_INVALID = "SESSION_MESSAGE_ENTITY_INVALID";

export const MESSAGE_TYPE = "message";
export const TOOL_CALL_MESSAGE_TYPE = "tool_call";
export const TOOL_RESULT_MESSAGE_TYPE = "tool_result";

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

export function requireCommittedMessageTimestamp(message) {
  const { ts } = message;
  if (!isCanonicalMessageTimestamp(ts)) {
    throw new TypeError(`committed message ts must be a canonical ISO timestamp: ${String(ts)}`);
  }
  return ts;
}

export function assertUncommittedMessageDraft(draft) {
  if (Object.hasOwn(draft, "ts")) {
    throw new TypeError("uncommitted message draft must not carry ts");
  }
  return draft;
}

export function readSessionMessageDraftAttachments(message) {
  if (message.attachments === undefined) return [];
  if (!Array.isArray(message.attachments)) {
    throw new TypeError("Session message draft attachments must be an array");
  }
  return message.attachments;
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
  if (record.type === TOOL_CALL_MESSAGE_TYPE) {
    if (!Array.isArray(record.tool_calls) || !record.tool_calls.length) {
      errors.push("tool_calls_required");
    }
  } else if (Object.hasOwn(record, "tool_calls")) {
    errors.push("tool_calls_forbidden");
  }
  if (Object.hasOwn(record, "workspaceRootDirectory")) {
    if (!isCanonicalText(record.workspaceRootDirectory))
      errors.push("workspace_root_not_canonical");
    if (record.role !== "assistant" || record.chatPresentation !== true)
      errors.push("workspace_root_requires_assistant_presentation");
  }
  return errors;
}

export function assertSessionMessageEntity(record) {
  const errors = collectSessionMessageEntityErrors(record);
  return requireValidMessage(record, errors);
}

export function assertSessionMessageMetadata({ value, parts }) {
  const record = value.message;
  const deferred = parts.some(
    ({ path }) => path.length === 2 && path[0] === "message" && path[1] === "content",
  );
  const errors = collectSessionMessageEntityErrors(record).filter(
    (error) => !(deferred && record.content === null && error === "content_not_string"),
  );
  if (deferred && record.content !== null) errors.push("content_slot_not_null");
  for (const { path } of parts)
    if (record[path[1]] !== null) errors.push(`${path[1]}_slot_not_null`);
  return requireValidMessage(record, errors);
}

function requireValidMessage(record, errors) {
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
