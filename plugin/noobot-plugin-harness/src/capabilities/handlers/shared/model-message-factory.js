/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { extractRawTextContent } from "./message-utils.js";

function normalizeMessage(message = {}) {
  const role = String(message?.role || "").trim().toLowerCase();
  if (!role) return null;
  const content = String(extractRawTextContent(message?.content ?? message) || "").trim();
  const toolCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : Array.isArray(message?.toolCalls)
      ? message.toolCalls
      : Array.isArray(message?.additional_kwargs?.tool_calls)
        ? message.additional_kwargs.tool_calls
        : [];
  const toolCallId = String(
    message?.tool_call_id || message?.toolCallId || message?.lc_kwargs?.tool_call_id || "",
  ).trim();
  if (!content && !toolCalls.length && !toolCallId) return null;
  const normalized = { role, content };
  if (toolCalls.length) normalized.tool_calls = toolCalls;
  if (toolCallId) normalized.tool_call_id = toolCallId;
  return normalized;
}

export function buildCapabilityModelMessages({
  locale = "zh-CN",
  agentMessages = [],
  constraints = [],
  task = "",
} = {}) {
  void locale;
  const normalizedTask = String(task || "").trim();
  const flattenedAgentMessages = (Array.isArray(agentMessages) ? agentMessages : [])
    .map((item = {}) => normalizeMessage(item))
    .filter(Boolean);
  const constraintMessages = (Array.isArray(constraints) ? constraints : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map((content) => ({ role: "system", content }));
  const output = [...flattenedAgentMessages, ...constraintMessages];
  if (normalizedTask) {
    output.push({ role: "user", content: normalizedTask });
  }
  return output;
}
