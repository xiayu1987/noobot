/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { partitionJournalError } from "./errors.js";

const fields = Object.freeze([
  "message",
  "sessionOrdinal",
  "turnOrdinal",
  "previousDialogUserUid",
  "contentBytes",
  "contentVersion",
  "contentCount",
  "sessionId",
  "dialogProcessId",
  "turnScopeId",
  "messageUid",
  "modelMessageId",
  "presentationMessageId",
  "userMessageId",
  "role",
  "type",
  "content",
  "attachments",
  "ts",
  "messageOrigin",
  "messageCount",
  "dialogOrdinal",
  "userMessageUid",
  "turnCount",
  "count",
  "directory",
  "ordinals",
  "commandId",
  "commandType",
  "requestHash",
  "aggregateVersion",
  "result",
  "turnReplacement",
  "replacedTurnScopeIds",
  "messageSuffix",
  "firstOrdinal",
  "previousMessageCount",
  "anchor",
  "newContent",
  "createdAt",
  "updatedAt",
  "parentSessionId",
  "caller",
  "sequence",
  "activeTurnScopeId",
  "revision",
  "summarized",
  "version",
  "eventId",
  "envelope",
  "identity",
  "ordering",
  "injectedMessageCount",
  "toolLogCount",
  "displayToolLogCount",
  "unassignedToolArtifactCount",
  "conflictedToolArtifactCount",
  "displayMessageCount",
  "thinkingMessageCount",
  "attachmentCount",
  "hasToolDetails",
  "checkpointId",
  "checkpointRevision",
  "previousRevision",
  "firstChunk",
  "firstByteChunk",
  "lastChunk",
  "userName",
  "modelAlias",
  "modelName",
  "parentDialogProcessId",
  "persistedMessageUids",
  "summarizedMessageUids",
  "retainedMessageUids",
  "markedCount",
  "committedAt",
]);
const identifiers = new Map(fields.map((field, index) => [field, String(index)]));

export function encodeJournalKey(key) {
  return identifiers.get(key) ?? `:${key}`;
}

function decodeKey(key) {
  if (key.startsWith(":")) {
    const literal = key.slice(1);
    if (!identifiers.has(literal)) return literal;
  } else {
    const index = Number(key);
    if (Number.isSafeInteger(index) && index >= 0 && String(index) === key && index < fields.length)
      return fields[index];
  }
  throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid journal object key token");
}

function decodeParsedValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1)
      value[index] = decodeParsedValue(value[index]);
    return value;
  }
  const result = {};
  for (const token of Object.keys(value)) {
    const key = decodeKey(token);
    const entry = decodeParsedValue(value[token]);
    if (key === "__proto__") {
      Object.defineProperty(result, key, {
        value: entry,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else result[key] = entry;
  }
  return result;
}

export function decodeJournalKeyJson(text) {
  return decodeParsedValue(JSON.parse(text));
}
