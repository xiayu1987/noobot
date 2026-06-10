/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";
import { LOCALE } from "../constants.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";

export const HARNESS_CAPABILITY_MODEL_CONTEXT_MESSAGE_LIMIT =
  WORKFLOW_PARAMS.contextWindow.capabilityModelRecentMessageLimit;

function isHarnessInjectedMessage(message = {}) {
  return (
    message?.injectedMessage === true &&
    String(message?.injectedBy || "").trim() === "harness-plugin"
  );
}

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

function resolveInjectedMessageType(messageItem = {}) {
  if (!messageItem || typeof messageItem !== "object") return "";
  if (messageItem?.injectedMessage !== true && !String(messageItem?.injectedBy || "").trim()) {
    return "";
  }
  const explicitType = String(
    messageItem?.injectedMessageType ||
      messageItem?.injected_message_type ||
      messageItem?.lc_kwargs?.injectedMessageType ||
      messageItem?.lc_kwargs?.injected_message_type ||
      "",
  ).trim();
  if (explicitType) return explicitType;
  const genericType = String(messageItem?.type || messageItem?.lc_kwargs?.type || "").trim();
  if (genericType && genericType !== "message") return genericType;
  return String(messageItem?.injectedBy || messageItem?.lc_kwargs?.injectedBy || "injected_message").trim();
}

function collectLatestInjectedMessageIndexes(messages = []) {
  const latestByType = new Map();
  const source = Array.isArray(messages) ? messages : [];
  for (let index = 0; index < source.length; index += 1) {
    const messageItem = source[index] || {};
    const type = resolveInjectedMessageType(messageItem);
    if (!type) continue;
    const injectedBy = String(messageItem?.injectedBy || messageItem?.lc_kwargs?.injectedBy || "").trim();
    latestByType.set(`${injectedBy || "injected"}:${type}`, index);
  }
  return new Set(latestByType.values());
}

export function isMessageSummarized(messageItem = {}) {
  if (!messageItem || typeof messageItem !== "object") return false;
  if (messageItem?.summarized === true) return true;
  if (messageItem?.lc_kwargs?.summarized === true) return true;
  return false;
}

export function filterSummarizedHarnessMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).filter(
    (messageItem) => !isMessageSummarized(messageItem),
  );
}

export function clipHarnessMessageWindow(
  messages = [],
  limit = HARNESS_CAPABILITY_MODEL_CONTEXT_MESSAGE_LIMIT,
) {
  const source = Array.isArray(messages) ? messages : [];
  const resolvedLimit = Number(limit);
  if (!Number.isFinite(resolvedLimit) || resolvedLimit <= 0) return source;
  const keepCount = Math.floor(resolvedLimit);
  if (source.length <= keepCount) return source;
  return source.slice(-keepCount);
}

export function filterAndClipHarnessCapabilityMessages(
  messages = [],
  limit = HARNESS_CAPABILITY_MODEL_CONTEXT_MESSAGE_LIMIT,
) {
  return clipHarnessMessageWindow(filterSummarizedHarnessMessages(messages), limit);
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
  const latestInjectedIndexes = collectLatestInjectedMessageIndexes(messages);
  let changedCount = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const messageItem = messages[index];
    const injectedType = resolveInjectedMessageType(messageItem);
    const shouldMark = injectedType
      ? !latestInjectedIndexes.has(index)
      : shouldMarkHarnessSummaryMessage(messageItem, {
          taskSummaryToolName: DEFAULT_TASK_SUMMARY_TOOL_NAME,
        });
    if (!shouldMark) continue;
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
  if (isHarnessInjectedMessage(message)) return null;
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
  const normalizedAgentMessages = filterAndClipHarnessCapabilityMessages(agentMessages)
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
      translateI18nText(locale, HARNESS_I18N_KEYSET.STRUCTURED_ENVELOPE.AGENT_HEADER),
      "```json",
      JSON.stringify(normalizedAgentMessages, null, 2),
      "```",
    ].join("\n"),
  });
  if (normalizedConstraints.length) {
    output.push({
      role: "system",
      content: [
        translateI18nText(locale, HARNESS_I18N_KEYSET.STRUCTURED_ENVELOPE.CONSTRAINT_HEADER),
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
  return (
    text.startsWith(translateI18nText(LOCALE.EN_US, HARNESS_I18N_KEYSET.STRUCTURED_ENVELOPE.AGENT_HEADER)) ||
    text.startsWith(translateI18nText(LOCALE.ZH_CN, HARNESS_I18N_KEYSET.STRUCTURED_ENVELOPE.AGENT_HEADER))
  );
}
