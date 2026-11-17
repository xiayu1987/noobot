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
import { isDeepFrozen } from "@noobot/shared/deep-freeze";
import { readSessionMessageDraftAttachments } from "@noobot/session-protocol";
import { assertMessageIdentity } from "@noobot/session-protocol/message-identity";
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

function setPresentMetadata(metadata, field, value) {
  if (value !== undefined && value !== null) metadata[field] = value;
}

export function projectSessionRecordSelectionMetadata(record) {
  const source = requireRecord(record);
  const messageUid = assertMessageIdentity("messageUid", source.messageUid);
  const role = source.role;
  if (!SESSION_CONTEXT_ROLES.has(role)) {
    throw new TypeError(`Session Context projection rejects role: ${role}`);
  }
  const metadata = { messageUid };
  for (const field of PROJECTED_TEXT_FIELDS)
    setPresentMetadata(metadata, field, presentText(source[field]));
  for (const field of PROJECTED_FLAG_FIELDS) {
    if (source[field] === true) metadata[field] = true;
  }
  return { role, additional_kwargs: metadata };
}

function buildSessionRecordContextMessage(record) {
  const source = requireRecord(record);
  const { role, additional_kwargs: metadata } = projectSessionRecordSelectionMetadata(source);
  const toolCalls = optionalArray(source.tool_calls, "tool_calls");
  const toolCallId = presentText(source.tool_call_id);
  const attachments = readSessionMessageDraftAttachments(source);
  const transferEnvelopes = normalizeContextTransferEnvelopes(
    optionalArray(source.transferEnvelopes, "transferEnvelopes"),
  );
  setPresentMetadata(metadata, "rawModelContent", normalizeRawModelContent(source.rawModelContent));
  for (const field of ["contextPolicy", "modelAdditionalKwargs", "modelResponseMetadata"])
    setPresentMetadata(metadata, field, optionalPlainObject(source[field], field));
  if (attachments.length) metadata.attachments = attachments;
  if (transferEnvelopes.length) metadata.transferEnvelopes = transferEnvelopes;
  const userMetaParsedResults = optionalArray(
    source.userMetaParsedResults,
    "userMetaParsedResults",
  );
  if (userMetaParsedResults.length) metadata.userMetaParsedResults = userMetaParsedResults;
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

const immutableRecordProjections = new WeakMap();

export function projectSessionRecordToContextMessage(record) {
  if (!isDeepFrozen(record)) return buildSessionRecordContextMessage(record);
  let projection = immutableRecordProjections.get(record);
  if (!projection) {
    projection = buildSessionRecordContextMessage(record);
    Object.freeze(projection.additional_kwargs);
    Object.freeze(projection);
    immutableRecordProjections.set(record, projection);
  }
  return { ...projection, additional_kwargs: { ...projection.additional_kwargs } };
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
  const messageUid = assertMessageIdentity(
    "messageUid",
    readContextMessageValue(message, "messageUid"),
  );
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
