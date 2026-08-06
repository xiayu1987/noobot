/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nowIso } from "../../model/timeFields.js";
import { sanitizeExecutionLogText } from "./utils.js";

const TOOL_LOG_TYPES = new Set(["tool_call", "tool_result"]);

function formatToolLifecycleText(data = {}, toolEventType = "") {
  if (!toolEventType) return "";
  const toolName = String(data.tool || data.name || "tool").trim() || "tool";
  const payload = toolEventType === "tool_call"
    ? (data.args ?? data.arguments)
    : (data.result ?? data.output);
  let payloadText = "";
  if (typeof payload === "string") payloadText = payload;
  else if (payload != null) {
    try {
      payloadText = JSON.stringify(payload);
    } catch {
      payloadText = String(payload);
    }
  }
  const action = toolEventType === "tool_call" ? "call" : "result";
  return `[tool] ${toolName} ${action}${payloadText ? `: ${payloadText}` : ""}`;
}

function formatToolLifecycleDetail(data = {}, toolEventType = "") {
  if (!toolEventType) return "";
  const payload = toolEventType === "tool_call"
    ? (data.args ?? data.arguments)
    : (data.result ?? data.output);
  if (payload === undefined || payload === null || payload === "") return "";
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export function classifyRealtimeLog(data = {}) {
  const nestedData = data?.data && typeof data.data === "object" ? data.data : {};
  const authoritativeEventType = String(data.eventType || "").trim();
  const authoritativeToolEvent = authoritativeEventType === "tool_call_start"
    ? "tool_call"
    : authoritativeEventType === "tool_call_end"
      ? "tool_result"
      : "";
  const eventName = String(
    authoritativeToolEvent || data.event || authoritativeEventType,
  ).trim();
  const rawText = data.text ?? data.output ?? data.message ??
    nestedData.text ?? nestedData.output ?? nestedData.message ?? "";
  const displayText = sanitizeExecutionLogText(
    rawText || formatToolLifecycleText(data, authoritativeToolEvent),
  );
  const category = String(data.category || "").trim();
  const type = String(data.type || "").trim();
  const isTool =
    category === "tool" ||
    TOOL_LOG_TYPES.has(type) ||
    TOOL_LOG_TYPES.has(eventName) ||
    eventName.startsWith("tool_") ||
    displayText.startsWith("[tool]") ||
    displayText.includes('"tool_call_id"');
  return {
    ...data,
    toolCallId: String(
      data.toolCallId || data.tool_call_id || nestedData.toolCallId || nestedData.tool_call_id || "",
    ),
    tool: String(data.tool || data.toolName || nestedData.tool || nestedData.toolName || ""),
    event: eventName || "system",
    type: authoritativeToolEvent || type ||
      (TOOL_LOG_TYPES.has(eventName) ? eventName : (isTool ? "tool_call" : "system")),
    text: displayText,
    detailText: formatToolLifecycleDetail(data, authoritativeToolEvent) || displayText,
    dialogProcessId: String(data.dialogProcessId || ""),
    ts: String(data.ts || nowIso()),
    category: isTool ? "tool" : "system",
    subAgentCall: Boolean(data.subAgentCall),
    subAgentSessionId: String(data.subAgentSessionId || ""),
    subAgentLabel: String(data.subAgentLabel || ""),
    subAgentTask: String(data.subAgentTask || ""),
  };
}
