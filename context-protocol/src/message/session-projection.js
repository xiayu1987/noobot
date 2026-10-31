/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  attachmentIdentityKey,
  normalizeTransferEnvelopes,
} from "@noobot/semantic-transfer-protocol";
import { isPlainObject } from "@noobot/shared/value";
import {
  readContextMessageValue,
  readContextMessageArray,
  resolveContextMessageRole,
  writeContextMessageMetadata,
} from "./codec.js";

const SESSION_CONTEXT_ROLES = new Set(["system", "user", "assistant", "tool"]);

export function resolveContextMessageAttachments(message) {
  const attachments = new Map();
  const add = (identity, descriptor) => {
    const key = attachmentIdentityKey(identity);
    const existing = attachments.get(key);
    const projected = {
      attachmentId: identity.attachmentId,
      sessionId: identity.sessionId,
      attachmentSource: identity.attachmentSource,
    };
    for (const field of ["name", "mimeType", "size"]) {
      const original = existing?.[field];
      const incoming = descriptor[field];
      if (original !== undefined && incoming !== undefined && original !== incoming)
        throw new TypeError(`context_attachment_metadata_conflict:${field}`);
      if (original !== undefined) projected[field] = original;
      else if (incoming !== undefined) projected[field] = incoming;
    }
    attachments.set(key, projected);
  };
  for (const record of readContextMessageArray(message, "attachments")) {
    const identity = {
      attachmentId: record?.attachmentId,
      sessionId: record?.sessionId,
      attachmentSource: record?.attachmentSource,
    };
    add(identity, record);
  }
  for (const envelope of normalizeTransferEnvelopes(
    readContextMessageArray(message, "transferEnvelopes"),
  )) {
    if (envelope.payload.mode !== "attachment") continue;
    for (const { identity, ...descriptor } of envelope.payload.attachments) {
      add(identity, descriptor);
    }
  }
  return [...attachments.values()];
}

function requireRecord(record) {
  if (!isPlainObject(record)) {
    throw new TypeError("Session Context projection requires a record object");
  }
  return record;
}

function requireText(value, field) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new TypeError(`Session Context projection requires ${field}`);
  return normalized;
}

function optionalArray(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError(`Session Context projection requires ${field} to be an array`);
  }
  return value;
}

function optionalPlainObject(value, field) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    throw new TypeError(`Session Context projection requires ${field} to be an object`);
  }
  return value;
}

function normalizeRawModelContent(value) {
  return typeof value === "string" || Array.isArray(value) ? value : null;
}

export function normalizeContextTransferEnvelopes(envelopes = []) {
  if (!Array.isArray(envelopes)) {
    throw new TypeError("Session Context transferEnvelopes must be an array");
  }
  return normalizeTransferEnvelopes(envelopes);
}

const PROJECTED_TEXT_FIELDS = Object.freeze([
  "userName",
  "sessionId",
  "parentSessionId",
  "dialogProcessId",
  "parentDialogProcessId",
  "turnScopeId",
  "injectedBy",
  "injectedMessageType",
  "messageOrigin",
  "noobotInternalMessageType",
  "relayCorrelationId",
  "terminalStatus",
  "terminalReason",
]);

const PROJECTED_FLAG_FIELDS = Object.freeze([
  "summarized",
  "injectedMessage",
  "pluginMessage",
  "terminalHistoryProjection",
  "terminalHistoryExplanation",
]);

function presentText(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function projectSessionRecordToContextMessage(record = {}) {
  const source = requireRecord(record);
  const messageUid = requireText(source.messageUid, "messageUid");
  const role = requireText(source.role, "role").toLowerCase();
  if (!SESSION_CONTEXT_ROLES.has(role)) {
    throw new TypeError(`Session Context projection rejects role: ${role}`);
  }
  const toolCalls = optionalArray(source.tool_calls, "tool_calls");
  const toolCallId = presentText(source.tool_call_id);
  const attachments = optionalArray(source.attachments, "attachments");
  const transferEnvelopes = normalizeContextTransferEnvelopes(
    optionalArray(source.transferEnvelopes, "transferEnvelopes"),
  );
  const metadata = { messageUid };
  for (const field of PROJECTED_TEXT_FIELDS) metadata[field] = presentText(source[field]);
  for (const field of PROJECTED_FLAG_FIELDS) {
    metadata[field] = source[field] === true ? true : undefined;
  }
  metadata.rawModelContent = normalizeRawModelContent(source.rawModelContent) ?? undefined;
  metadata.contextPolicy = optionalPlainObject(source.contextPolicy, "contextPolicy") ?? undefined;
  metadata.modelAdditionalKwargs =
    optionalPlainObject(source.modelAdditionalKwargs, "modelAdditionalKwargs") ?? undefined;
  metadata.modelResponseMetadata =
    optionalPlainObject(source.modelResponseMetadata, "modelResponseMetadata") ?? undefined;
  metadata.attachments = attachments.length ? attachments : undefined;
  metadata.transferEnvelopes = transferEnvelopes.length ? transferEnvelopes : undefined;
  const userMetaParsedResults = optionalArray(
    source.userMetaParsedResults,
    "userMetaParsedResults",
  );
  metadata.userMetaParsedResults = userMetaParsedResults.length ? userMetaParsedResults : undefined;
  return writeContextMessageMetadata(
    {
      role,
      content: source.content ?? "",
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      ...(toolCallId ? { tool_call_id: toolCallId } : {}),
    },
    metadata,
  );
}

export function projectSessionRecordsToContextMessages(records = []) {
  if (!Array.isArray(records)) {
    throw new TypeError("Session Context projection requires a record array");
  }
  return records.map(projectSessionRecordToContextMessage);
}

const PROJECTED_STRUCTURED_FIELDS = Object.freeze([
  "rawModelContent",
  "contextPolicy",
  "modelAdditionalKwargs",
  "modelResponseMetadata",
  "attachments",
  "transferEnvelopes",
  "userMetaParsedResults",
]);

export function projectContextMessageToSessionRecord(message = {}) {
  if (message === null || typeof message !== "object" || Array.isArray(message)) {
    throw new TypeError("Context Session projection requires a message object");
  }
  const messageUid = requireText(readContextMessageValue(message, "messageUid"), "messageUid");
  const role = resolveContextMessageRole(message);
  if (!SESSION_CONTEXT_ROLES.has(role)) {
    throw new TypeError(`Context Session projection rejects role: ${role || "<empty>"}`);
  }
  const record = { messageUid, role, content: message.content ?? "" };
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    record.tool_calls = message.tool_calls;
  }
  const toolCallId = presentText(message.tool_call_id);
  if (toolCallId) record.tool_call_id = toolCallId;
  for (const field of PROJECTED_TEXT_FIELDS) {
    const value = presentText(readContextMessageValue(message, field));
    if (value !== undefined) record[field] = value;
  }
  for (const field of PROJECTED_FLAG_FIELDS) {
    if (readContextMessageValue(message, field) === true) record[field] = true;
  }
  for (const field of PROJECTED_STRUCTURED_FIELDS) {
    const value = readContextMessageValue(message, field);
    if (value !== undefined && value !== null) record[field] = value;
  }
  return record;
}
