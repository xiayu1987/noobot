/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isInjectedMessage } from "@noobot/context-protocol/policy/message";

const SHORT_MEMORY_RECORD_ROLES = new Set(["user", "assistant"]);

export function toShortMemoryRecords(messages = []) {
  const out = [];
  for (const messageItem of Array.isArray(messages) ? messages : []) {
    if (isInjectedMessage(messageItem)) continue;
    const role = String(messageItem?.role || "").trim();
    if (!SHORT_MEMORY_RECORD_ROLES.has(role)) continue;
    if (role === "assistant" && String(messageItem?.type || "").trim() === "tool_call") continue;
    const content = String(messageItem?.content || "").trim();
    if (!content) continue;
    out.push({ role, content });
  }
  return out;
}

function toTimestamp(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortShortMemoryItems(items = []) {
  return [...(Array.isArray(items) ? items : [])].sort(
    (left, right) => toTimestamp(left?.createdAt) - toTimestamp(right?.createdAt),
  );
}

export function excludeShortMemoryItemsBySessionIds(items = [], sessionIds = []) {
  const deletedSessionIds = new Set(
    (Array.isArray(sessionIds) ? sessionIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
  return (Array.isArray(items) ? items : []).filter((item) => {
    const sessionId = String(item?.sessionId || "").trim();
    const parentSessionId = String(item?.parentSessionId || "").trim();
    return !deletedSessionIds.has(sessionId) && !deletedSessionIds.has(parentSessionId);
  });
}
