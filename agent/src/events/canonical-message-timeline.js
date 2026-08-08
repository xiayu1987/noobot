/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MESSAGE_EVENT_TYPE } from "@noobot/shared/message-event-protocol";

export function isToolMessageEvent(envelope = {}) {
  return [MESSAGE_EVENT_TYPE.TOOL_CALL_START, MESSAGE_EVENT_TYPE.TOOL_CALL_END]
    .includes(envelope?.eventType);
}

export function isActivityMessageEvent(envelope = {}) {
  return [MESSAGE_EVENT_TYPE.THINKING, MESSAGE_EVENT_TYPE.MAIN_MODEL_CONTENT]
    .includes(envelope?.eventType);
}

export function reduceCanonicalToolTimeline(timeline = [], envelope = {}) {
  if (!isToolMessageEvent(envelope)) return Array.isArray(timeline) ? timeline : [];
  const toolCallId = String(envelope.toolCallId || envelope.tool_call_id || "").trim();
  if (!toolCallId) return Array.isArray(timeline) ? timeline : [];
  const key = `call:${toolCallId}`;
  const next = Array.isArray(timeline) ? timeline.map((item) => ({ ...item })) : [];
  const index = next.findIndex((item) => item.key === key);
  const current = index >= 0 ? next[index] : { key, toolCallId };
  const isCall = envelope.eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_START;
  const fact = {
    eventId: envelope.eventId,
    sequence: envelope.sequence,
    sequenceScopeId: envelope.sequenceScopeId,
    sequenceDomain: envelope.sequenceDomain,
    authority: "authoritative",
    timestamp: envelope.timestamp,
    sessionId: String(envelope.sessionId || "").trim(),
    dialogProcessId: String(envelope.dialogProcessId || "").trim(),
    turnScopeId: String(envelope.turnScopeId || "").trim(),
    ...(Array.isArray(envelope.attachments) && envelope.attachments.length
      ? { attachments: envelope.attachments }
      : {}),
  };
  const updated = isCall
    ? { ...current, tool: String(envelope.tool || "").trim(), args: envelope.args || {}, call: fact, status: current.resultEvent ? "completed" : "running" }
    : { ...current, tool: String(envelope.tool || current.tool || "").trim(), result: envelope.result, success: envelope.success !== false, resultEvent: fact, status: "completed" };
  if (index >= 0) next[index] = updated;
  else next.push(updated);
  return next;
}
