/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import crypto from "node:crypto";

import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

const DEFAULT_PREVIEW_LIMIT = QUANTITY_THRESHOLDS.diagnostics.modelContextPreviewLimit;
const DEFAULT_CONTENT_CHARS = LENGTH_THRESHOLDS.display.modelContextContentChars;

function readField(message = {}, field = "") {
  const key = String(field || "").trim();
  if (!key || !message || typeof message !== "object") return "";
  return String(
    message?.[key] ??
      message?.additional_kwargs?.[key] ??
      message?.lc_kwargs?.[key] ??
      message?.lc_kwargs?.additional_kwargs?.[key] ??
      "",
  ).trim();
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

function textHash(text = "") {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 16);
}

function incrementCount(counts, key) {
  const normalized = String(key || "unknown").trim() || "unknown";
  counts[normalized] = Number(counts[normalized] || 0) + 1;
}

function summarizeMessageDimensions(messages = []) {
  const roles = {};
  const dialogGroups = [];
  const dialogById = new Map();
  let missingDialogIdCount = 0;
  let summarizedCount = 0;
  for (const message of Array.isArray(messages) ? messages : []) {
    incrementCount(roles, resolveDiagnosticRole(message));
    const dialogProcessId = readField(message, "dialogProcessId") || readField(message, "dialogId");
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
    if (
      message?.summarized === true ||
      message?.lc_kwargs?.summarized === true ||
      message?.additional_kwargs?.summarized === true ||
      message?.lc_kwargs?.additional_kwargs?.summarized === true
    ) summarizedCount += 1;
  }
  return { roles, dialogGroups, missingDialogIdCount, summarizedCount };
}

export function resolveDiagnosticRole(message = {}) {
  const role = String(message?.role || message?.lc_kwargs?.role || "").trim().toLowerCase();
  if (role) return role;
  const type = String(
    message?.type ||
      message?.lc_kwargs?.type ||
      (typeof message?._getType === "function" ? message._getType() : ""),
  ).trim().toLowerCase();
  if (type === "ai") return "assistant";
  if (type === "human") return "user";
  return type;
}

function messageTraceItem(message = {}, index = 0, block = "") {
  const content = resolveContent(message);
  return {
    index,
    ...(block ? { block } : {}),
    role: resolveDiagnosticRole(message),
    messageId: readField(message, "noobotMessageId") || undefined,
    type: String(message?.type || message?.lc_kwargs?.type || "").trim() || undefined,
    dialogProcessId: readField(message, "dialogProcessId") || undefined,
    turnScopeId: readField(message, "turnScopeId") || undefined,
    injectedMessageType: readField(message, "injectedMessageType") || readField(message, "injected_message_type") || undefined,
    internalType: readField(message, "noobotInternalMessageType") || undefined,
    summarized: message?.summarized === true || message?.lc_kwargs?.summarized === true || message?.additional_kwargs?.summarized === true || undefined,
    contentHash: textHash(content),
    contentPreview: content.replace(/\s+/g, " ").slice(0, DEFAULT_CONTENT_CHARS),
  };
}

export function summarizeDiagnosticMessages(messages = [], { limit = DEFAULT_PREVIEW_LIMIT, block = "" } = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const safeLimit = Math.max(0, Number(limit) || 0);
  return {
    count: source.length,
    ...summarizeMessageDimensions(source),
    preview: source.slice(0, safeLimit).map((message, index) => messageTraceItem(message, index, block)),
    truncated: source.length > safeLimit ? source.length - safeLimit : 0,
  };
}

export function summarizeDiagnosticBlocks(blocks = null, { limit = DEFAULT_PREVIEW_LIMIT } = {}) {
  const safeBlocks = blocks && typeof blocks === "object" && !Array.isArray(blocks) ? blocks : {};
  return {
    system: summarizeDiagnosticMessages(safeBlocks.system, { limit, block: "system" }),
    history: summarizeDiagnosticMessages(safeBlocks.history, { limit, block: "history" }),
    incremental: summarizeDiagnosticMessages(safeBlocks.incremental, { limit, block: "incremental" }),
  };
}
