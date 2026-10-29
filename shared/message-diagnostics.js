/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import crypto from "node:crypto";

import { LENGTH_THRESHOLDS } from "./length-thresholds.js";
import { QUANTITY_THRESHOLDS } from "./quantity-thresholds.js";
import { isPlainObject, text, isObjectLike, stableValue } from "./value.js";

const DEFAULT_PREVIEW_LIMIT = QUANTITY_THRESHOLDS.diagnostics.modelContextPreviewLimit;
const DEFAULT_CONTENT_CHARS = LENGTH_THRESHOLDS.display.modelContextContentChars;

function readMetadata(message = {}) {
  const metadata = isObjectLike(message) ? message.additional_kwargs : null;
  return isObjectLike(metadata) ? metadata : {};
}

function readField(message = {}, field = "") {
  return text(readMetadata(message)[field]);
}

function isSummarized(message = {}) {
  return readMetadata(message).summarized === true;
}

function resolveContent(message = {}) {
  const content = message?.content ?? message?.lc_kwargs?.content ?? "";
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content ?? "");
  }
}

function textHash(value = "") {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 16);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function providerMessageValue(message = {}) {
  const dictionary = typeof message?.toDict === "function" ? message.toDict() : null;
  const dictionaryData =
    dictionary?.data && typeof dictionary.data === "object" ? dictionary.data : {};
  const role = resolveDiagnosticRole(message) || text(dictionary?.type);
  const content = firstDefined(
    message?.content,
    message?.lc_kwargs?.content,
    dictionaryData.content,
    "",
  );
  const name = firstDefined(message?.name, message?.lc_kwargs?.name, dictionaryData.name);
  const toolCalls = firstDefined(
    message?.tool_calls,
    message?.lc_kwargs?.tool_calls,
    dictionaryData.tool_calls,
    message?.additional_kwargs?.tool_calls,
    message?.lc_kwargs?.additional_kwargs?.tool_calls,
  );
  const toolCallId = firstDefined(
    message?.tool_call_id,
    message?.lc_kwargs?.tool_call_id,
    dictionaryData.tool_call_id,
  );
  return {
    role,
    content,
    ...(name !== undefined ? { name } : {}),
    ...(toolCalls !== undefined ? { tool_calls: toolCalls } : {}),
    ...(toolCallId !== undefined ? { tool_call_id: toolCallId } : {}),
  };
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

export function fingerprintDiagnosticMessages(messages = []) {
  const source = Array.isArray(messages) ? messages : [];
  const fingerprints = source.map((message) => sha256(providerMessageValue(message)));
  return {
    fingerprintProtocolVersion: 2,
    fingerprints,
    sequenceHash: sha256(fingerprints),
  };
}

function incrementCount(counts, key) {
  const normalized = text(key) || "unknown";
  counts[normalized] = Number(counts[normalized] || 0) + 1;
}

function summarizeMessageDimensions(messages = []) {
  const roles = {};
  const dialogGroups = [];
  const dialogById = new Map();
  let missingDialogIdCount = 0;
  let missingMessageUidCount = 0;
  let summarizedCount = 0;
  for (const message of Array.isArray(messages) ? messages : []) {
    incrementCount(roles, resolveDiagnosticRole(message));
    const dialogProcessId = readField(message, "dialogProcessId");
    if (!dialogProcessId) {
      missingDialogIdCount += 1;
    } else {
      let group = dialogById.get(dialogProcessId);
      if (!group) {
        group = { dialogProcessId, count: 0 };
        dialogById.set(dialogProcessId, group);
        dialogGroups.push(group);
      }
      group.count += 1;
    }
    if (!readField(message, "messageUid")) missingMessageUidCount += 1;
    if (isSummarized(message)) summarizedCount += 1;
  }
  return {
    roles,
    dialogGroups,
    missingDialogIdCount,
    missingMessageUidCount,
    summarizedCount,
  };
}

export function resolveDiagnosticRole(message = {}) {
  const role = String(message?.role || message?.lc_kwargs?.role || "")
    .trim()
    .toLowerCase();
  if (role) return role;
  const type = String(message?.type || message?.lc_kwargs?.type || "")
    .trim()
    .toLowerCase();
  if (type === "ai") return "assistant";
  if (type === "human") return "user";
  return type;
}

function messageEvidenceItem(message = {}, index = 0, block = "") {
  const content = resolveContent(message);
  return {
    index,
    ...(block ? { block } : {}),
    role: resolveDiagnosticRole(message),
    messageUid: readField(message, "messageUid") || undefined,
    type: String(message?.type || message?.lc_kwargs?.type || "").trim() || undefined,
    dialogProcessId: readField(message, "dialogProcessId") || undefined,
    turnScopeId: readField(message, "turnScopeId") || undefined,
    injectedMessageType: readField(message, "injectedMessageType") || undefined,
    internalType: readField(message, "noobotInternalMessageType") || undefined,
    summarized: isSummarized(message) || undefined,
    contentLength: content.length,
    contentHash: textHash(content),
  };
}

function messageTraceItem(message = {}, index = 0, block = "") {
  const content = resolveContent(message);
  return {
    ...messageEvidenceItem(message, index, block),
    contentPreview: content.replace(/\s+/g, " ").slice(0, DEFAULT_CONTENT_CHARS),
  };
}

export function summarizeDiagnosticMessages(
  messages = [],
  { limit = DEFAULT_PREVIEW_LIMIT, block = "" } = {},
) {
  const source = Array.isArray(messages) ? messages : [];
  const safeLimit = Math.max(0, Number(limit) || 0);
  return {
    count: source.length,
    ...summarizeMessageDimensions(source),
    ...fingerprintDiagnosticMessages(source),
    evidence: source.map((message, index) => messageEvidenceItem(message, index, block)),
    preview: source
      .slice(0, safeLimit)
      .map((message, index) => messageTraceItem(message, index, block)),
    truncated: source.length > safeLimit ? source.length - safeLimit : 0,
  };
}

export function summarizeDiagnosticBlocks(blocks = null, { limit = DEFAULT_PREVIEW_LIMIT } = {}) {
  const safeBlocks = isPlainObject(blocks) ? blocks : {};
  return {
    system: summarizeDiagnosticMessages(safeBlocks.system, { limit, block: "system" }),
    history: summarizeDiagnosticMessages(safeBlocks.history, { limit, block: "history" }),
    incremental: summarizeDiagnosticMessages(safeBlocks.incremental, {
      limit,
      block: "incremental",
    }),
  };
}
