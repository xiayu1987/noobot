/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createTurnExecutionIndex,
  requireTurnExecutionIndex,
  requireExecutionSegmentSequence,
  EXECUTION_EVENT_INDEX_ERROR_CODE,
} from "@noobot/session-protocol/execution-event-index";

export function reconcileExecutionSegmentIndex(index, segments) {
  const current = requireTurnExecutionIndex(index);
  if (!Array.isArray(segments)) {
    throw new TypeError("reconcileExecutionSegmentIndex requires segment metadata");
  }
  const metadata = new Map(segments.map((segment) => [segment.file, segment]));
  if (metadata.size !== segments.length)
    throw new TypeError("reconcileExecutionSegmentIndex requires unique segment metadata");
  const repaired = new Set();
  const next = current.segments.map((entry) => {
    const actual = metadata.get(entry.file);
    if (!actual) {
      throw new TypeError(`reconcileExecutionSegmentIndex requires metadata for ${entry.file}`);
    }
    if (entry.bytes === actual.bytes && entry.records === actual.records) return entry;
    repaired.add(entry.file);
    return { ...entry, bytes: actual.bytes, records: actual.records };
  });
  const known = new Set(current.segments.map(({ file }) => file));
  const discovered = segments
    .filter(({ file }) => !known.has(file))
    .map((segment) => ({ ...segment, sequence: requireExecutionSegmentSequence(segment.file) }))
    .sort((left, right) => left.sequence - right.sequence);
  for (const actual of discovered) {
    const previous = next.at(-1);
    if (actual.sequence !== (previous ? previous.sequence + 1 : 1))
      throw Object.assign(new Error("unindexed execution segments are not a contiguous suffix"), {
        code: EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED,
      });
    if (previous && !previous.sealed) {
      next[next.length - 1] = { ...previous, sealed: true };
      repaired.add(previous.file);
    }
    next.push({
      sequence: actual.sequence,
      file: actual.file,
      bytes: actual.bytes,
      records: actual.records,
      sealed: false,
    });
    repaired.add(actual.file);
  }
  return { index: createTurnExecutionIndex(next), repaired: [...repaired] };
}
