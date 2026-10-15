/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  resolveContextMessageRole,
  resolveContextMessageOrigin,
  resolveContextToolCallId,
  resolveContextToolCalls,
} from "../message/codec.js";
import { text } from "@noobot/shared/value";

function resolveRole(message = {}) {
  return resolveContextMessageRole(message);
}

function extractContextTextContent(content = "") {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item = {}) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        return text(item?.text || item?.content || item?.value);
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (typeof content === "object") {
    return text(content?.text || content?.content || content?.value);
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
    if (resolveContextMessageOrigin(message) === "natural") normalized.messageOrigin = "natural";
    return normalized;
  }
  if (role === "tool") {
    const toolCallId = resolveContextToolCallId(message);
    if (!toolCallId) throw new TypeError("auxiliary tool result requires tool_call_id");
    return { role, content, tool_call_id: toolCallId };
  }
  if (!content) return null;
  const normalized = { role, content };
  if (resolveContextMessageOrigin(message) === "natural") normalized.messageOrigin = "natural";
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
    const id = text(message.tool_call_id);
    if (!declared.has(id)) throw new Error(`orphan auxiliary tool result: ${id}`);
    if (completed.has(id)) throw new Error(`duplicate auxiliary tool result: ${id}`);
    completed.add(id);
  }
}

function formatToolCallForObserver(toolCalls = []) {
  return toolCalls
    .map((call = {}) => {
      const fn = call.function && typeof call.function === "object" ? call.function : call;
      const name = text(fn.name) || "tool";
      const args =
        typeof fn.arguments === "string"
          ? fn.arguments
          : JSON.stringify(fn.arguments ?? call.args ?? {});
      return `Tool call [${resolveContextToolCallId(call)}]: ${name}(${args})`;
    })
    .join("\n");
}

function formatToolResultForObserver(message = {}) {
  return `Tool result [${message.tool_call_id}] (matching tool result of the executed call above):\n${message.content}`;
}

export function projectAuxiliaryHistoryMessages(
  sourceMessages = [],
  { decorateMessage = null, projectObserverPerspective = true } = {},
) {
  if (!Array.isArray(sourceMessages)) {
    throw new TypeError("auxiliary history sourceMessages must be an array");
  }
  const entries = sourceMessages
    .map((sourceMessage, index) => {
      const normalized = normalizeMessage(sourceMessage);
      if (!normalized) return null;
      return { message: normalized, sourceMessage, index };
    })
    .filter(Boolean);
  const normalizedMessages = entries.map(({ message }) => message);
  assertToolEvidenceAlignment(normalizedMessages);
  const projected = projectObserverPerspective
    ? normalizedMessages.map((message) => {
        if (message.role === "tool") {
          return {
            role: "assistant",
            content: formatToolResultForObserver(message),
            ...(resolveContextMessageOrigin(message) === "natural"
              ? { messageOrigin: "natural" }
              : {}),
          };
        }
        if (
          message.role === "assistant" &&
          Array.isArray(message.tool_calls) &&
          message.tool_calls.length
        ) {
          return { role: "user", content: formatToolCallForObserver(message.tool_calls) };
        }
        return message;
      })
    : normalizedMessages;
  return projected.map((message, index) =>
    typeof decorateMessage === "function"
      ? decorateMessage(message, entries[index].sourceMessage, entries[index].index)
      : message,
  );
}
