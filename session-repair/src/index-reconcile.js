/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function reconcileExecutionSegmentIndex(index = {}, segments = []) {
  const next = structuredClone(index);
  const metadata = new Map(segments.map((segment) => [segment.file, segment]));
  const repaired = [];
  for (const entry of Array.isArray(next.segments) ? next.segments : []) {
    const actual = metadata.get(entry.file);
    if (!actual) continue;
    if (Number(entry.bytes) === actual.bytes && Number(entry.records) === actual.records) continue;
    entry.bytes = actual.bytes;
    entry.records = actual.records;
    repaired.push(entry.file);
  }
  return { index: next, repaired };
}

export function reconcileSessionSummaryIndex({ sessions, sessionIds }) {
  const allowedIds = new Set(sessionIds);
  const next = [];
  const seen = new Set();
  let changed = false;
  for (const item of sessions) {
    const { sessionId } = item;
    if (!allowedIds.has(sessionId) || seen.has(sessionId)) {
      changed = true;
      continue;
    }
    seen.add(sessionId);
    next.push(item);
  }
  if (next.length !== allowedIds.size) changed = true;
  return { sessions: next, changed };
}
