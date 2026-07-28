/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { sanitizeExecutionLogText } from "../../modules/chat/runtime/engine/utils.js";
import { formatLocalTime, nowIso } from "../../modules/chat/model/timeFields.js";

const TOOL_LOG_TYPES = new Set(["tool_call", "tool_result"]);

function formatToolLifecycleText(data = {}, toolEventType = "") {
  if (!toolEventType) return "";
  const toolName = String(data.tool || data.name || "tool").trim() || "tool";
  const payload = toolEventType === "tool_call"
    ? (data.args ?? data.arguments)
    : (data.result ?? data.output);
  let payloadText = "";
  if (typeof payload === "string") {
    payloadText = payload;
  } else if (payload != null) {
    try {
      payloadText = JSON.stringify(payload);
    } catch {
      payloadText = String(payload);
    }
  }
  const action = toolEventType === "tool_call" ? "call" : "result";
  return `[tool] ${toolName} ${action}${payloadText ? `: ${payloadText}` : ""}`;
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
  const text = sanitizeExecutionLogText(
    rawText || formatToolLifecycleText(data, authoritativeToolEvent),
  );
  const category = String(data.category || "").trim();
  const type = String(data.type || "").trim();
  const isTool =
    category === "tool" ||
    TOOL_LOG_TYPES.has(type) ||
    TOOL_LOG_TYPES.has(eventName) ||
    eventName.startsWith("tool_") ||
    text.startsWith("[tool]") ||
    text.includes('"tool_call_id"');
  return {
    ...data,
    toolCallId: String(
      data.toolCallId || data.tool_call_id || nestedData.toolCallId || nestedData.tool_call_id || "",
    ),
    tool: String(data.tool || data.toolName || nestedData.tool || nestedData.toolName || ""),
    event: eventName || "system",
    type: authoritativeToolEvent || type ||
      (TOOL_LOG_TYPES.has(eventName) ? eventName : (isTool ? "tool_call" : "system")),
    text,
    dialogProcessId: String(data.dialogProcessId || ""),
    ts: String(data.ts || nowIso()),
    category: isTool ? "tool" : "system",
    subAgentCall: Boolean(data.subAgentCall),
    subAgentSessionId: String(data.subAgentSessionId || ""),
    subAgentLabel: String(data.subAgentLabel || ""),
    subAgentTask: String(data.subAgentTask || ""),
  };
}

export function isImageMime(type = "") {
  return type.startsWith("image/");
}

export function formatFileSize(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTime(ts) {
  return formatLocalTime(ts);
}

export function hasActiveSessionForReconnect({ activeSession = {}, activeSessionId = "" } = {}) {
  return Boolean(
    String(activeSession?.backendSessionId || "").trim() ||
      String(activeSession?.id || "").trim() ||
      String(activeSessionId || "").trim(),
  );
}
