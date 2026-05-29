/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { extractRawTextContent } from "../message/utils.js";

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

function resolveToolCallName(toolCall = {}) {
  if (!toolCall || typeof toolCall !== "object") return "";
  if (toolCall.function && typeof toolCall.function === "object") {
    const fnName = String(toolCall.function.name || "").trim();
    if (fnName) return fnName;
  }
  const name = String(toolCall.name || "").trim();
  return name;
}

function resolveToolCallArguments(toolCall = {}) {
  if (!toolCall || typeof toolCall !== "object") return "";
  if (toolCall.function && typeof toolCall.function === "object") {
    const fnArgs = toolCall.function.arguments;
    if (typeof fnArgs === "string") return fnArgs.trim();
    if (fnArgs && typeof fnArgs === "object") {
      try {
        return JSON.stringify(fnArgs);
      } catch {
        return String(fnArgs);
      }
    }
  }
  const args = toolCall.args;
  if (typeof args === "string") return args.trim();
  if (args && typeof args === "object") {
    try {
      return JSON.stringify(args);
    } catch {
      return String(args);
    }
  }
  return "";
}

function buildToolCallSemanticText(toolCalls = [], locale = "zh-CN") {
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  if (!calls.length) return "";
  const normalizedLocale = String(locale || "").trim().toLowerCase();
  const isEnglish = normalizedLocale === "en-us";
  return calls
    .map((toolCall = {}) => {
      const name = resolveToolCallName(toolCall) || (isEnglish ? "unknown_script" : "未知脚本");
      const args = resolveToolCallArguments(toolCall) || (isEnglish ? "none" : "无参数");
      if (isEnglish) {
        return `Semantic execution: run ${name} script with arguments ${args}`;
      }
      return `语义执行 ${name}脚本,参数${args}`;
    })
    .join("\n");
}

function rewriteMessageForCapabilityContext(message = {}, locale = "zh-CN") {
  const normalized = normalizeMessageForCompatibility(message);
  if (!normalized) return null;

  if (normalized.role === "tool") {
    return {
      role: "assistant",
      content: String(normalized.content || "").trim(),
    };
  }

  if (normalized.role === "assistant" && Array.isArray(normalized.tool_calls) && normalized.tool_calls.length) {
    const semanticContent = buildToolCallSemanticText(normalized.tool_calls, locale);
    if (!semanticContent) return null;
    return {
      role: "user",
      content: semanticContent,
    };
  }

  const passthrough = {
    role: normalized.role,
    content: String(normalized.content || "").trim(),
  };
  if (normalized.frontendUserMessage === true) {
    passthrough.frontendUserMessage = true;
  }
  return passthrough;
}

export function buildCapabilityModelMessages({
  locale = "zh-CN",
  agentMessages = [],
  constraints = [],
  task = "",
} = {}) {
  const normalizedTask = String(task || "").trim();
  const flattenedAgentMessages = (Array.isArray(agentMessages) ? agentMessages : [])
    .map((item = {}) => rewriteMessageForCapabilityContext(item, locale))
    .filter((item) => item && String(item.content || "").trim());
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
