/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { extractRawTextContent } from "../message/utils.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";

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
  return calls
    .map((toolCall = {}) => {
      const name =
        resolveToolCallName(toolCall) ||
        translateI18nText(locale, HARNESS_I18N_KEYSET.MESSAGE_FACTORY.TOOL_CALL_UNKNOWN_SCRIPT);
      const args =
        resolveToolCallArguments(toolCall) ||
        translateI18nText(locale, HARNESS_I18N_KEYSET.MESSAGE_FACTORY.TOOL_CALL_NO_ARGUMENTS);
      return translateI18nText(locale, HARNESS_I18N_KEYSET.MESSAGE_FACTORY.TOOL_CALL_SEMANTIC_LINE, {
        name,
        args,
      });
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

function normalizeModelMessageRole(role = "", fallback = "user") {
  const normalized = String(role || "").trim().toLowerCase();
  return normalized || fallback;
}

function normalizeTextList(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

export function buildCapabilityModelMessages({
  locale = "zh-CN",
  agentMessages = [],
  constraints = [],
  task = "",
  postTaskSystemMessages = [],
  postTaskMessages = [],
  taskRole = "user",
  postTaskRole = "user",
} = {}) {
  const normalizedTask = String(task || "").trim();
  const normalizedPostTaskSystemMessages = normalizeTextList(postTaskSystemMessages);
  const normalizedPostTaskMessages = normalizeTextList(postTaskMessages);
  const flattenedAgentMessages = (Array.isArray(agentMessages) ? agentMessages : [])
    .map((item = {}) => rewriteMessageForCapabilityContext(item, locale))
    .filter((item) => item && String(item.content || "").trim());
  const constraintMessages = normalizeTextList(constraints)
    .map((content) => ({ role: "system", content }));
  const output = [...flattenedAgentMessages, ...constraintMessages];
  const resolvedTaskRole = normalizeModelMessageRole(taskRole, "user");
  const resolvedPostTaskRole = normalizeModelMessageRole(postTaskRole, resolvedTaskRole);
  if (normalizedTask) {
    output.push({ role: resolvedTaskRole, content: normalizedTask });
  }
  for (const content of normalizedPostTaskSystemMessages) {
    output.push({ role: "system", content });
  }
  for (const content of normalizedPostTaskMessages) {
    output.push({ role: resolvedPostTaskRole, content });
  }
  return output;
}


export function buildCapabilityProtocolModelMessages({
  locale = "zh-CN",
  agentMessages = [],
  contextMessages = [],
  protocolPrompt = "",
  workflowPolicyPrompt = "",
  responsibilityPrompt = "",
} = {}) {
  return buildCapabilityModelMessages({
    locale,
    agentMessages,
    constraints: contextMessages,
    task: protocolPrompt,
    taskRole: "system",
    postTaskSystemMessages: [workflowPolicyPrompt],
    postTaskMessages: [responsibilityPrompt],
    postTaskRole: "user",
  });
}
