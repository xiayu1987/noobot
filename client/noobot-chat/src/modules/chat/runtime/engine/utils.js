/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nowIso } from "../../model/timeFields.js";
import { text } from "@noobot/shared/value";

export function normalizeTrimmedString(value) {
  return text(value);
}

const INTERNAL_EVENT_PLACEHOLDER_LINE_RE =
  /^\[(tool_call|tool_result|session_turn_full|assistant_message_saved|system)\]$/;

const INTERNAL_EXECUTION_EVENT_NAMES = new Set([
  "session_turn_full",
  "assistant_message_saved",
  "system",
]);

export function stripInternalEventPlaceholderLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .filter((line) => !INTERNAL_EVENT_PLACEHOLDER_LINE_RE.test(line.trim()))
    .join("\n")
    .trim();
}

export function sanitizeExecutionLogText(value) {
  return stripInternalEventPlaceholderLines(value);
}

function stringifyExecutionValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value);
  } catch {
    return text(value);
  }
}

function pickExecutionToolName(logItem = {}) {
  return normalizeTrimmedString(
    logItem?.toolName ||
      logItem?.name ||
      logItem?.function?.name ||
      (typeof logItem?.tool === "string" ? logItem.tool : "") ||
      logItem?.tool?.name ||
      logItem?.data?.toolName ||
      logItem?.data?.name ||
      (typeof logItem?.data?.tool === "string" ? logItem.data.tool : "") ||
      logItem?.data?.tool?.name ||
      logItem?.data?.function?.name,
  );
}

function pickExecutionToolArgs(logItem = {}) {
  return stringifyExecutionValue(
    logItem?.args ??
      logItem?.arguments ??
      logItem?.input ??
      logItem?.params ??
      logItem?.rawInput ??
      logItem?.rawArgs ??
      logItem?.function?.arguments ??
      logItem?.data?.args ??
      logItem?.data?.arguments ??
      logItem?.data?.input ??
      logItem?.data?.params ??
      logItem?.data?.rawInput ??
      logItem?.data?.rawArgs ??
      logItem?.data?.function?.arguments,
  );
}

function pickExecutionToolResult(logItem = {}) {
  return stringifyExecutionValue(
    logItem?.result ??
      logItem?.output ??
      logItem?.content ??
      logItem?.data?.result ??
      logItem?.data?.output ??
      logItem?.data?.content,
  );
}

function toolResultStatusKey(logItem = {}) {
  const status = normalizeTrimmedString(
    logItem?.status || logItem?.state || logItem?.data?.status || logItem?.data?.state,
  ).toLowerCase();
  const success = logItem?.success ?? logItem?.data?.success;
  if (success === false || ["failed", "failure", "error", "errored"].includes(status)) {
    return "message.executionStatusFailed";
  }
  if (["cancelled", "canceled", "aborted"].includes(status)) {
    return "message.executionStatusCancelled";
  }
  return "message.executionStatusCompleted";
}

function isToolLifecycleResult(logItem = {}, inputText = "") {
  const eventType = normalizeTrimmedString(logItem?.eventType || logItem?.rawEvent).toLowerCase();
  return eventType === "tool_call_end" || /^[\w.-]+\s+completed(?:\s|$)/i.test(inputText);
}

function buildToolResultDisplay(logItem = {}, commandText = "", inputText = "") {
  if (!isToolLifecycleResult(logItem, inputText)) return { text: commandText, statusKey: "" };
  const compactToolName = inputText.match(/^([\w.-]+)\s+completed(?:\s|$)/i)?.[1] || "";
  const command = pickExecutionToolName(logItem) || commandText || compactToolName;
  return { text: normalizeTrimmedString(command), statusKey: toolResultStatusKey(logItem) };
}

function pickExecutionCommandText(logItem = {}) {
  const explicitCommand = stringifyExecutionValue(
    logItem?.command ??
      logItem?.cmd ??
      logItem?.displayText ??
      logItem?.description ??
      logItem?.data?.command ??
      logItem?.data?.cmd ??
      logItem?.data?.displayText ??
      logItem?.data?.description ??
      logItem?.metadata?.command ??
      logItem?.metadata?.cmd ??
      logItem?.metadata?.displayText,
  );
  if (explicitCommand) return explicitCommand;

  const inputText = sanitizeExecutionLogText(logItem?.text);
  if (inputText && !/^[\w.-]+\s+(started|completed)$/i.test(inputText)) return inputText;

  const toolName = pickExecutionToolName(logItem);
  const toolArgs = pickExecutionToolArgs(logItem);
  const commandFromToolFields = [toolName, toolArgs].filter(Boolean).join(" ").trim();
  if (commandFromToolFields) return commandFromToolFields;

  return inputText;
}

function buildExecutionLogDisplay(logItem = {}) {
  const eventName = normalizeTrimmedString(logItem?.event).toLowerCase();
  const typeName = normalizeTrimmedString(logItem?.type).toLowerCase();
  const inputText = sanitizeExecutionLogText(logItem?.text);
  const isToolCall = eventName === "tool_call" || typeName === "tool_call";
  const isToolResult = eventName === "tool_result" || typeName === "tool_result";
  if (isToolCall) return { text: pickExecutionCommandText(logItem), statusKey: "" };
  if (isToolResult) {
    const commandText = pickExecutionCommandText(logItem) || pickExecutionToolResult(logItem);
    return commandText
      ? buildToolResultDisplay(logItem, commandText, inputText)
      : { text: inputText, statusKey: "" };
  }
  return { text: inputText, statusKey: "" };
}

function isInternalExecutionLog(logItem = {}) {
  const eventName = normalizeTrimmedString(logItem?.event).toLowerCase();
  const typeName = normalizeTrimmedString(logItem?.type).toLowerCase();
  return (
    INTERNAL_EXECUTION_EVENT_NAMES.has(eventName) || INTERNAL_EXECUTION_EVENT_NAMES.has(typeName)
  );
}

export function sanitizeExecutionLogForDisplay(logItem = {}) {
  const { text: inputText, statusKey } = buildExecutionLogDisplay(logItem);
  if (!inputText || isInternalExecutionLog(logItem)) return null;
  return statusKey ? { ...logItem, text: inputText, statusKey } : { ...logItem, text: inputText };
}

export function isBlankCompatibleSameId(left, right) {
  const normalizedLeft = normalizeTrimmedString(left);
  const normalizedRight = normalizeTrimmedString(right);
  return !normalizedLeft || !normalizedRight || normalizedLeft === normalizedRight;
}

export function normalizeExecutionLogForRealtime(logItem = {}) {
  const data = logItem?.data && typeof logItem.data === "object" ? logItem.data : {};
  const rawEvent = normalizeTrimmedString(logItem?.event);
  const inputText = sanitizeExecutionLogText(
    data?.text ||
      logItem?.text ||
      data?.displayText ||
      logItem?.displayText ||
      data?.content ||
      logItem?.content,
  );
  return {
    ...logItem,
    ...data,
    event:
      normalizeTrimmedString(data?.event || rawEvent || logItem?.status || "execution_step") ||
      "execution_step",
    type: normalizeTrimmedString(data?.type || logItem?.type || "execution") || "execution",
    category:
      normalizeTrimmedString(data?.category || logItem?.category || "execution") || "execution",
    dialogProcessId: normalizeTrimmedString(data?.dialogProcessId || logItem?.dialogProcessId),
    ts: normalizeTrimmedString(data?.ts || logItem?.ts) || nowIso(),
    text: inputText,
  };
}
