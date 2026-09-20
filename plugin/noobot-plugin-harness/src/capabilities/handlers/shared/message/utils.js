/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveContextMessageContent,
  resolveContextMessageRole,
  resolveContextToolCalls,
} from "@noobot/context-protocol/message/codec";
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

export function shouldSkipAnalysisForTrailingToolCallContent(messages = []) {
  const items = Array.isArray(messages) ? messages : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const message = items[index];
    if (!message || typeof message !== "object") continue;
    if (isHarnessInjectedMessage(message)) continue;
    const role = resolveContextMessageRole(message);
    if (role !== "assistant") continue;

    const toolCalls = resolveContextToolCalls(message);
    if (!toolCalls.length) return false;
    const content = resolveContextMessageContent(message);
    return Boolean(String(content || "").trim());
  }
  return false;
}

function normalizePromptMessageItem(message = {}) {
  if (isHarnessInjectedMessage(message)) return null;
  const role = String(message?.role || "")
    .trim()
    .toLowerCase();
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
