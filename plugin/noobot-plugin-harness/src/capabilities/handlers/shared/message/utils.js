/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";

export function isHarnessInjectedMessage(message = {}, { role = "", type = "" } = {}) {
  const expectedRole = String(role || "").trim();
  const expectedType = String(type || "").trim();
  return (
    message?.injectedMessage === true &&
    String(message?.injectedBy || "").trim() === "harness-plugin" &&
    (!expectedRole || String(message?.role || "").trim() === expectedRole) &&
    (!expectedType || String(message?.injectedMessageType || "").trim() === expectedType)
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

function resolveMessageToolCalls(message = {}) {
  if (Array.isArray(message?.tool_calls)) return message.tool_calls;
  if (Array.isArray(message?.toolCalls)) return message.toolCalls;
  if (Array.isArray(message?.additional_kwargs?.tool_calls)) {
    return message.additional_kwargs.tool_calls;
  }
  if (Array.isArray(message?.lc_kwargs?.tool_calls)) return message.lc_kwargs.tool_calls;
  return [];
}

function resolveMessageRole(message = {}) {
  const role = String(message?.role || message?.lc_kwargs?.role || "")
    .trim()
    .toLowerCase();
  if (role === "ai") return "assistant";
  if (role === "human") return "user";
  if (role) return role;
  const type = String(
    message?.type ||
      message?.lc_kwargs?.type ||
      (typeof message?._getType === "function" ? message._getType() : ""),
  )
    .trim()
    .toLowerCase();
  if (type === "ai") return "assistant";
  if (type === "human") return "user";
  return type;
}

export function shouldSkipAnalysisForTrailingToolCallContent(messages = []) {
  const items = Array.isArray(messages) ? messages : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const message = items[index];
    if (!message || typeof message !== "object") continue;
    if (isHarnessInjectedMessage(message)) continue;
    const role = resolveMessageRole(message);
    if (role !== "assistant") continue;
    const toolCalls = resolveMessageToolCalls(message);
    if (!toolCalls.length) return false;
    const content = extractRawTextContent(
      message?.content ?? message?.lc_kwargs?.content ?? "",
    );
    return Boolean(String(content || "").trim());
  }
  return false;
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

export function isMessageSummarized(messageItem = {}) {
  if (!messageItem || typeof messageItem !== "object") return false;
  if (messageItem?.summarized === true) return true;
  if (messageItem?.lc_kwargs?.summarized === true) return true;
  return false;
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
