/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  readContextMessageField,
  resolveContextMessageContent,
  resolveContextMessageRole,
  resolveContextToolCalls,
} from "@noobot/context-protocol/message/codec";
import { isInjectedMessage } from "@noobot/context-protocol/policy/message";
import {
  isInjectedSessionMessageRecord,
  resolveSessionMessageRecordInjectedType,
} from "@noobot/session-protocol";
import { text, isObjectLike } from "@noobot/shared/value";
import { HARNESS_INJECTED_MESSAGE_BY_VALUE } from "../constants.js";

export function readAfterLlmCallText(ctx) {
  const modelResponse = ctx.modelResponse;
  if (!isObjectLike(modelResponse)) {
    throw new TypeError("after_llm_call context requires modelResponse");
  }
  return text(modelResponse.text);
}

export function isHarnessInjectedMessage(message = {}, { role = "", type = "" } = {}) {
  const expectedRole = text(role);
  const expectedType = text(type);
  return (
    isInjectedMessage(message) &&
    readContextMessageField(message, "injectedBy") === HARNESS_INJECTED_MESSAGE_BY_VALUE &&
    (!expectedRole || resolveContextMessageRole(message) === expectedRole) &&
    (!expectedType || readContextMessageField(message, "injectedMessageType") === expectedType)
  );
}

export function isHarnessInjectedSessionRecord(record = {}, { role = "", type = "" } = {}) {
  const expectedRole = text(role);
  const expectedType = text(type);
  return (
    isInjectedSessionMessageRecord(record) &&
    text(record?.injectedBy) === HARNESS_INJECTED_MESSAGE_BY_VALUE &&
    (!expectedRole || text(record?.role) === expectedRole) &&
    (!expectedType || resolveSessionMessageRecordInjectedType(record) === expectedType)
  );
}

export function extractRawTextContent(input) {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return "";
  return input
    .map((item) => {
      if (typeof item === "string") return item;
      if (isObjectLike(item) && typeof item.text === "string") {
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
    if (!isObjectLike(message)) continue;
    if (isHarnessInjectedMessage(message)) continue;
    const role = resolveContextMessageRole(message);
    if (role !== "assistant") continue;

    const toolCalls = resolveContextToolCalls(message);
    if (!toolCalls.length) return false;
    const content = resolveContextMessageContent(message);
    return Boolean(text(content));
  }
  return false;
}
