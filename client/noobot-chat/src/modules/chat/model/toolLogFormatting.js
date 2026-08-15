/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
export { projectToolFileDisplay } from "@noobot/event-protocol/tool-presentation";

const TOOL_LOG_SUMMARY_LIMIT = QUANTITY_THRESHOLDS.toolIO.logSummaryLimit;
const FAILED_TOOL_STATUSES = new Set(["failed", "failure", "error", "errored"]);

function parseToolResultValue(value) {
  if (!value || typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function isToolResultFailure({ success, status, result, detailText } = {}) {
  if (success === false) return true;
  if (
    FAILED_TOOL_STATUSES.has(
      String(status || "")
        .trim()
        .toLowerCase(),
    )
  )
    return true;
  for (const value of [result, detailText]) {
    const parsed = parseToolResultValue(value);
    if (!parsed || typeof parsed !== "object") continue;
    if (parsed.ok === false || parsed.success === false) return true;
    if (
      FAILED_TOOL_STATUSES.has(
        String(parsed.status || "")
          .trim()
          .toLowerCase(),
      )
    )
      return true;
  }
  return false;
}

export function stringifyToolValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateToolSummary(value) {
  const text = String(value || "").trim();
  return text.length > TOOL_LOG_SUMMARY_LIMIT
    ? `${text.slice(0, TOOL_LOG_SUMMARY_LIMIT)}...`
    : text;
}

export function buildToolCallSummary(toolCall = {}, fallbackToolName = "unknown_tool") {
  const toolName = String(toolCall?.function?.name || toolCall?.name || fallbackToolName).trim();
  const argsText = truncateToolSummary(
    stringifyToolValue(toolCall?.function?.arguments ?? toolCall?.args ?? ""),
  );
  return argsText ? `${toolName}(${argsText})` : toolName;
}

export function buildToolResultSummary(
  content,
  fallbackToolName = "tool_result",
  { success } = {},
) {
  const normalizedFallback = String(fallbackToolName || "tool_result").trim();
  const contentText = String(content || "").trim();
  if (!contentText) return normalizedFallback;

  try {
    const parsed = JSON.parse(contentText);
    const toolName = String(parsed?.toolName || parsed?.name || normalizedFallback).trim();
    const status = String(parsed?.status || "").trim();
    const okText =
      typeof parsed?.ok === "boolean"
        ? `ok=${parsed.ok}`
        : typeof success === "boolean"
          ? `ok=${success}`
          : "";
    return [toolName, status, okText].filter(Boolean).join(" ");
  } catch {
    return [normalizedFallback, typeof success === "boolean" ? `ok=${success}` : ""]
      .filter(Boolean)
      .join(" ");
  }
}

export function buildToolNameByCallId(messages = []) {
  const toolNameByCallId = new Map();
  for (const message of messages || []) {
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    for (const toolCall of toolCalls) {
      const callId = String(toolCall?.id || "").trim();
      const toolName = String(toolCall?.function?.name || toolCall?.name || "").trim();
      if (callId && toolName) toolNameByCallId.set(callId, toolName);
    }
  }
  return toolNameByCallId;
}
