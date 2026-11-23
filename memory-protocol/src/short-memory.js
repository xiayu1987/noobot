/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isInjectedSessionMessageRecord } from "@noobot/session-protocol";
import { isCanonicalText, text } from "@noobot/shared/value";

export { selectShortMemoryBatch, acknowledgeShortMemoryBatch } from "./short-memory-batch.js";

const SHORT_MEMORY_RECORD_ROLES = new Set(["user", "assistant"]);

export function toShortMemoryRecords(messages = []) {
  const out = [];
  for (const messageItem of Array.isArray(messages) ? messages : []) {
    if (isInjectedSessionMessageRecord(messageItem)) continue;
    const role = text(messageItem?.role);
    if (!SHORT_MEMORY_RECORD_ROLES.has(role)) continue;
    if (role === "assistant" && text(messageItem?.type) === "tool_call") continue;
    const content = text(messageItem?.content);
    if (!content) continue;
    out.push({ role, content });
  }
  return out;
}

export async function collectShortMemoryRecords({ sessionId, dialogProcessId, messageRecords }) {
  if (
    !isCanonicalText(sessionId) ||
    !isCanonicalText(dialogProcessId) ||
    (!messageRecords?.[Symbol.asyncIterator] && !messageRecords?.[Symbol.iterator])
  )
    throw new TypeError("Short memory capture requires a scoped message record stream");
  const retained = [];
  const seen = new Set();
  for await (const record of messageRecords) {
    if (
      !Number.isSafeInteger(record?.ordinal) ||
      record.ordinal < 1 ||
      seen.has(record.ordinal) ||
      record.message?.sessionId !== sessionId ||
      record.message.dialogProcessId !== dialogProcessId
    )
      throw new TypeError("Short memory message record ownership or order is invalid");
    seen.add(record.ordinal);
    for (const value of toShortMemoryRecords([record.message]))
      retained.push({ ordinal: record.ordinal, value });
  }
  retained.sort((left, right) => left.ordinal - right.ordinal);
  return retained.map(({ value }) => value);
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
