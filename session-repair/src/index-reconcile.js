/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createTurnExecutionIndex,
  requireTurnExecutionIndex,
} from "@noobot/session-protocol/execution-event-index";

export function reconcileExecutionSegmentIndex(index, segments) {
  const current = requireTurnExecutionIndex(index);
  if (!Array.isArray(segments)) {
    throw new TypeError("reconcileExecutionSegmentIndex requires segment metadata");
  }
  const metadata = new Map(segments.map((segment) => [segment.file, segment]));
  const repaired = [];
  const next = current.segments.map((entry) => {
    const actual = metadata.get(entry.file);
    if (!actual) {
      throw new TypeError(`reconcileExecutionSegmentIndex requires metadata for ${entry.file}`);
    }
    if (entry.bytes === actual.bytes && entry.records === actual.records) return entry;
    repaired.push(entry.file);
    return { ...entry, bytes: actual.bytes, records: actual.records };
  });
  return { index: createTurnExecutionIndex(next), repaired };
}
