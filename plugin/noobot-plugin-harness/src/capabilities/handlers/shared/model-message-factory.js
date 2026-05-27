/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { extractRawTextContent } from "./message-utils.js";

function resolveCompatibleRole(message = {}) {
  const role = String(message?.role || message?.lc_kwargs?.role || "").trim().toLowerCase();
  if (role) return role;
  const type = String(message?.type || message?.lc_kwargs?.type || "").trim().toLowerCase();
  if (type === "ai") return "assistant";
  if (type === "human") return "user";
  if (type === "system") return "system";
  if (type === "tool") return "tool";
  return "";
}

function normalizeMessageForCompatibility(message = {}) {
  const role = resolveCompatibleRole(message);
  if (!role) return null;
  const content = String(
    extractRawTextContent(message?.content ?? message?.lc_kwargs?.content ?? message) || "",
  ).trim();
  const normalized = { role, content };
  const toolCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : Array.isArray(message?.toolCalls)
      ? message.toolCalls
      : Array.isArray(message?.additional_kwargs?.tool_calls)
        ? message.additional_kwargs.tool_calls
        : Array.isArray(message?.lc_kwargs?.tool_calls)
          ? message.lc_kwargs.tool_calls
          : [];
  if (toolCalls.length) normalized.tool_calls = toolCalls;
  const toolCallId = String(
    message?.tool_call_id ||
      message?.toolCallId ||
      message?.lc_kwargs?.tool_call_id ||
      "",
  ).trim();
  if (toolCallId) normalized.tool_call_id = toolCallId;
  if (
    message?.frontendUserMessage === true ||
    message?.lc_kwargs?.frontendUserMessage === true ||
    message?.additional_kwargs?.frontendUserMessage === true ||
    message?.lc_kwargs?.additional_kwargs?.frontendUserMessage === true
  ) {
    normalized.frontendUserMessage = true;
  }
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
    .map((item = {}) => normalizeMessageForCompatibility(item))
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
