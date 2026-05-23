/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function extractRawTextContent(input) {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return "";
  return input
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && typeof item.text === "string") {
        return item.text;
      }
      return "";
    })
    .join("\n")
    .trim();
}

export function safeJsonStringify(value = null, space = 2) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      value,
      (_key, current) => {
        if (typeof current === "bigint") return String(current);
        if (typeof current === "function") {
          return `[Function ${current.name || "anonymous"}]`;
        }
        if (current && typeof current === "object") {
          if (seen.has(current)) return "[Circular]";
          seen.add(current);
        }
        return current;
      },
      space,
    );
  } catch (error) {
    return JSON.stringify({
      error: "ctx_serialize_failed",
      message: String(error?.message || error || ""),
    });
  }
}

export function cleanupInternalForcedMessages(messages = []) {
  if (!Array.isArray(messages)) return 0;
  let removed = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const marker =
      message?.additional_kwargs?.noobotInternalMessageType ||
      message?.lc_kwargs?.additional_kwargs?.noobotInternalMessageType ||
      message?.metadata?.noobotInternalMessageType ||
      message?.lc_kwargs?.metadata?.noobotInternalMessageType ||
      "";
    if (!String(marker || "").trim()) continue;
    messages.splice(index, 1);
    removed += 1;
  }
  return removed;
}

export function sanitizeInternalMessages(ctx = {}) {
  let changed = false;
  if (cleanupInternalForcedMessages(ctx?.messages || []) > 0) {
    changed = true;
  }
  const systemMessages = ctx?.agentContext?.payload?.messages?.system;
  const historyMessages = ctx?.agentContext?.payload?.messages?.history;
  if (cleanupInternalForcedMessages(systemMessages || []) > 0) {
    changed = true;
  }
  if (cleanupInternalForcedMessages(historyMessages || []) > 0) {
    changed = true;
  }
  return changed;
}

function markMessageSummarized(messageItem = null) {
  if (!messageItem || typeof messageItem !== "object") return false;
  if (messageItem.summarized === true && messageItem?.lc_kwargs?.summarized === true) return false;
  messageItem.summarized = true;
  if (messageItem?.lc_kwargs && typeof messageItem.lc_kwargs === "object") {
    messageItem.lc_kwargs.summarized = true;
  }
  return true;
}

const DEFAULT_TASK_SUMMARY_TOOL_NAME = "task_summary";

function resolveToolNamesFromToolCalls(toolCalls = []) {
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .map((toolCall = {}) => {
      if (!toolCall || typeof toolCall !== "object") return "";
      if (toolCall.name) return String(toolCall.name || "").trim();
      const fn =
        toolCall.function && typeof toolCall.function === "object"
          ? toolCall.function
          : {};
      return String(fn.name || "").trim();
    })
    .filter(Boolean);
}

function getMessageToolCalls(messageItem = {}) {
  if (Array.isArray(messageItem?.tool_calls)) return messageItem.tool_calls;
  if (Array.isArray(messageItem?.lc_kwargs?.tool_calls)) return messageItem.lc_kwargs.tool_calls;
  if (Array.isArray(messageItem?.additional_kwargs?.tool_calls)) return messageItem.additional_kwargs.tool_calls;
  return [];
}

function resolveToolNameFromMessage(messageItem = {}) {
  const explicitToolName = String(
    messageItem?.toolName || messageItem?.tool_name || "",
  ).trim();
  if (explicitToolName) return explicitToolName;
  try {
    const parsed = JSON.parse(String(messageItem?.content || ""));
    return String(parsed?.toolName || "").trim();
  } catch {
    return "";
  }
}

function shouldMarkHarnessSummaryMessage(
  messageItem = {},
  { taskSummaryToolName = DEFAULT_TASK_SUMMARY_TOOL_NAME } = {},
) {
  if (!messageItem || typeof messageItem !== "object") return false;
  const role = String(messageItem?.role || messageItem?.lc_kwargs?.role || "").trim().toLowerCase();
  if (role === "system" || role === "user") return false;
  if (role === "tool") {
    return resolveToolNameFromMessage(messageItem) !== taskSummaryToolName;
  }
  if (role !== "assistant") return false;
  const toolCallNames = resolveToolNamesFromToolCalls(getMessageToolCalls(messageItem));
  if (toolCallNames.includes(taskSummaryToolName)) return false;
  return !String(messageItem?.content || "").trim();
}

export function markMessagesSummarized(messages = []) {
  if (!Array.isArray(messages)) return 0;
  let changedCount = 0;
  for (const messageItem of messages) {
    if (
      !shouldMarkHarnessSummaryMessage(messageItem, {
        taskSummaryToolName: DEFAULT_TASK_SUMMARY_TOOL_NAME,
      })
    ) {
      continue;
    }
    if (markMessageSummarized(messageItem)) {
      changedCount += 1;
    }
  }
  return changedCount;
}

export function resolveInjectedMessageSummarizer(meta = {}) {
  return typeof meta?.harness?.markMessagesSummarized === "function"
    ? meta.harness.markMessagesSummarized
    : null;
}

function normalizePromptMessageItem(message = {}) {
  const role = String(message?.role || "").trim().toLowerCase();
  if (!role) return null;
  const content = extractRawTextContent(message?.content ?? message);
  const text = String(content || "").trim();
  if (!text) return null;
  return { role, content: text };
}

export function buildModelMessagesWithStructuredEnvelope({
  locale = "zh-CN",
  agentMessages = [],
  constraints = [],
  task = "",
} = {}) {
  const isEn = String(locale || "").trim().toLowerCase() === "en-us";
  const normalizedAgentMessages = (Array.isArray(agentMessages) ? agentMessages : [])
    .map((item = {}) => normalizePromptMessageItem(item))
    .filter(Boolean);
  const normalizedConstraints = (Array.isArray(constraints) ? constraints : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const taskText = String(task || "").trim();

  const output = [];
  output.push({
    role: "system",
    content: [
      isEn ? "[Agent message context]" : "[Agent消息上下文]",
      "```json",
      JSON.stringify(normalizedAgentMessages, null, 2),
      "```",
    ].join("\n"),
  });
  if (normalizedConstraints.length) {
    output.push({
      role: "system",
      content: [
        isEn ? "[Constraint context]" : "[约束上下文]",
        ...normalizedConstraints,
      ].join("\n"),
    });
  }
  if (taskText) {
    output.push({
      role: "user",
      content: taskText,
    });
  }
  return output;
}

export function isStructuredEnvelopeMessages(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) return false;
  const first = list[0];
  if (String(first?.role || "").trim().toLowerCase() !== "system") return false;
  const text = String(first?.content || "").trim();
  return text.startsWith("[Agent message context]") || text.startsWith("[Agent消息上下文]");
}
