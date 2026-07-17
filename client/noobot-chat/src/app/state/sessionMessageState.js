/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { sanitizeExecutionLogText } from "../../composables/chat/chatEngine/utils";
import { formatLocalTime, nowIso } from "../../composables/infra/timeFields";

const TOOL_LOG_TYPES = new Set(["tool_call", "tool_result"]);

export function classifyRealtimeLog(data = {}) {
  const eventName = String(data.event || "").trim();
  const text = sanitizeExecutionLogText(
    data.text ?? data.output ?? data.data?.text ?? data.data?.output ?? "",
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
    event: eventName || "system",
    type: type || (isTool ? "tool_call" : "system"),
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
