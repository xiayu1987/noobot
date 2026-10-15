/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isInjectedMessage } from "@noobot/context-protocol/policy/message";
import { text } from "@noobot/shared/value";

const SHORT_MEMORY_RECORD_ROLES = new Set(["user", "assistant"]);

export function toShortMemoryRecords(messages = []) {
  const out = [];
  for (const messageItem of Array.isArray(messages) ? messages : []) {
    if (isInjectedMessage(messageItem)) continue;
    const role = text(messageItem?.role);
    if (!SHORT_MEMORY_RECORD_ROLES.has(role)) continue;
    if (role === "assistant" && text(messageItem?.type) === "tool_call") continue;
    const content = text(messageItem?.content);
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
    (Array.isArray(sessionIds) ? sessionIds : []).map((value) => text(value)).filter(Boolean),
  );
  return (Array.isArray(items) ? items : []).filter((item) => {
    const sessionId = text(item?.sessionId);
    const parentSessionId = text(item?.parentSessionId);
    return !deletedSessionIds.has(sessionId) && !deletedSessionIds.has(parentSessionId);
  });
}
