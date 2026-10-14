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
import { isInjectedMessage, readMessageField } from "@noobot/context-protocol/policy/message";

export function isHarnessInjectedMessage(message = {}, { role = "", type = "" } = {}) {
  const expectedRole = String(role || "").trim();
  const expectedType = String(type || "").trim();
  return (
    isInjectedMessage(message) &&
    readMessageField(message, "injectedBy") === "harness-plugin" &&
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
