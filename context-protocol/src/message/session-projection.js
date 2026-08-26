/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { normalizeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";

const SESSION_CONTEXT_ROLES = new Set(["system", "user", "assistant", "tool"]);

function requireRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Session Context projection requires ${field} to be an object`);
  }
  return value;
}

export function normalizeContextTransferEnvelopes(envelopes = []) {
  if (!Array.isArray(envelopes)) {
    throw new TypeError("Session Context transferEnvelopes must be an array");
  }
  return normalizeTransferEnvelopes(envelopes);
}

export function projectSessionRecordToContextMessage(record = {}) {
  const source = requireRecord(record);
  const messageUid = requireText(source.messageUid, "messageUid");
  const role = requireText(source.role, "role").toLowerCase();
  if (!SESSION_CONTEXT_ROLES.has(role)) {
    throw new TypeError(`Session Context projection rejects role: ${role}`);
  }
  const attachments = optionalArray(source.attachments, "attachments");
  const transferEnvelopes = normalizeContextTransferEnvelopes(
    optionalArray(source.transferEnvelopes, "transferEnvelopes"),
  );
  return {
    messageUid,
    role,
    content: source.content ?? "",
    rawModelContent:
      typeof source.rawModelContent === "string" || Array.isArray(source.rawModelContent)
        ? source.rawModelContent
        : null,
    type: source.type || "",
    userName: source.userName || "",
    sessionId: source.sessionId || "",
    parentSessionId: source.parentSessionId || "",
    dialogProcessId: source.dialogProcessId || "",
    parentDialogProcessId: source.parentDialogProcessId || "",
    turnScopeId: source.turnScopeId || "",
    summarized: source.summarized === true,
    injectedMessage: source.injectedMessage === true,
    injectedBy: source.injectedBy || "",
    injectedMessageType: source.injectedMessageType || "",
    messageOrigin: source.messageOrigin || "",
    userMetaMaterialized: source.userMetaMaterialized === true,
    pluginMessage: source.pluginMessage === true,
    terminalHistoryProjection: source.terminalHistoryProjection === true,
    terminalHistoryExplanation: source.terminalHistoryExplanation === true,
    terminalStatus: source.terminalStatus || "",
    terminalReason: source.terminalReason || "",
    tool_calls: optionalArray(source.tool_calls, "tool_calls"),
    tool_call_id: source.tool_call_id || "",
    modelAdditionalKwargs: optionalPlainObject(
      source.modelAdditionalKwargs,
      "modelAdditionalKwargs",
    ),
    modelResponseMetadata: optionalPlainObject(
      source.modelResponseMetadata,
      "modelResponseMetadata",
    ),
    ...(attachments.length ? { attachments } : {}),
    ...(transferEnvelopes.length ? { transferEnvelopes } : {}),
  };
}

export function projectSessionRecordsToContextMessages(records = []) {
  if (!Array.isArray(records)) {
    throw new TypeError("Session Context projection requires a record array");
  }
  return records.map(projectSessionRecordToContextMessage);
}
