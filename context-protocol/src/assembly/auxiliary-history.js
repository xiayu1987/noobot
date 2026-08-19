/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  resolveContextMessageRole,
  resolveContextToolCallId,
  resolveContextToolCalls,
} from "../message/codec.js";

function resolveRole(message = {}) {
  return resolveContextMessageRole(message);
}

export function extractContextTextContent(content = "") {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item = {}) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        return String(item?.text || item?.content || item?.value || "").trim();
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (typeof content === "object") {
    return String(content?.text || content?.content || content?.value || "").trim();
  }
  return String(content).trim();
}

function normalizeMessage(message = {}) {
  const role = resolveRole(message);
  if (!role) throw new TypeError("auxiliary history message role is required");
  const content = extractContextTextContent(message?.content ?? message?.lc_kwargs?.content ?? "");
  if (role === "assistant") {
    const toolCalls = resolveContextToolCalls(message);
    if (!content && !toolCalls.length) return null;
    const normalized = {
      role,
      content,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    };
    if (
      message?.frontendUserMessage === true ||
      message?.additional_kwargs?.frontendUserMessage === true ||
      message?.lc_kwargs?.frontendUserMessage === true ||
      message?.lc_kwargs?.additional_kwargs?.frontendUserMessage === true
    ) {
      normalized.frontendUserMessage = true;
    }
    return normalized;
  }
  if (role === "tool") {
    const toolCallId = resolveContextToolCallId(message);
    if (!toolCallId) throw new TypeError("auxiliary tool result requires tool_call_id");
    return { role, content, tool_call_id: toolCallId };
  }
  if (!content) return null;
  const normalized = { role, content };
  if (
    message?.frontendUserMessage === true ||
    message?.additional_kwargs?.frontendUserMessage === true ||
    message?.lc_kwargs?.frontendUserMessage === true ||
    message?.lc_kwargs?.additional_kwargs?.frontendUserMessage === true
  ) {
    normalized.frontendUserMessage = true;
  }
  return normalized;
}

function assertToolEvidenceAlignment(messages = []) {
  const declared = new Set();
  const completed = new Set();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.tool_calls || []) {
        const id = resolveContextToolCallId(call);
        if (!id) throw new TypeError("auxiliary assistant tool call requires id");
        if (declared.has(id)) throw new Error(`duplicate auxiliary tool call id: ${id}`);
        declared.add(id);
      }
      continue;
    }
    if (message.role !== "tool") continue;
    const id = String(message.tool_call_id || "").trim();
    if (!declared.has(id)) throw new Error(`orphan auxiliary tool result: ${id}`);
    if (completed.has(id)) throw new Error(`duplicate auxiliary tool result: ${id}`);
    completed.add(id);
  }
}

export function projectAuxiliaryHistoryMessages(
  sourceMessages = [],
  { decorateMessage = null } = {},
) {
  if (!Array.isArray(sourceMessages)) {
    throw new TypeError("auxiliary history sourceMessages must be an array");
  }
  const projected = sourceMessages
    .map((sourceMessage, index) => {
      const normalized = normalizeMessage(sourceMessage);
      if (!normalized) return null;
      return typeof decorateMessage === "function"
        ? decorateMessage(normalized, sourceMessage, index)
        : normalized;
    })
    .filter(Boolean);
  assertToolEvidenceAlignment(projected);
  return projected;
}
