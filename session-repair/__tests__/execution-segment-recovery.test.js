/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createTurnExecutionIndex,
  requireExecutionSegmentSequence,
} from "@noobot/session-protocol/execution-event-index";
import { reconcileExecutionSegmentIndex } from "../src/index-reconcile.js";

const segment = (sequence, extra = {}) => ({
  sequence,
  file: `segment-${String(sequence).padStart(6, "0")}.jsonl`,
  bytes: 10,
  records: 1,
  sealed: false,
  ...extra,
});

test("segment filename decoding uses canonical protocol identity", () => {
  for (const sequence of [1, 999999, 1000000, Number.MAX_SAFE_INTEGER])
    assert.equal(requireExecutionSegmentSequence(segment(sequence).file), sequence);
  for (const file of [
    null,
    "segment-1.jsonl",
    "segment-000000.jsonl",
    "segment-0000001.jsonl",
    "segment-9007199254740992.jsonl",
    "../segment-000001.jsonl",
    "segment-000001.jsonl.tmp",
    "unknown.jsonl",
  ])
    assert.throws(() => requireExecutionSegmentSequence(file), {
      code: "EXECUTION_EVENT_INDEX_CORRUPTED",
    });
});

test("recovery orders a contiguous suffix and preserves published diagnostics without mutating its input", () => {
  const index = createTurnExecutionIndex([segment(1, { oversized: true })]);
  const result = reconcileExecutionSegmentIndex(index, [segment(3), segment(1), segment(2)]);
  assert.deepEqual(result.index.segments, [
    segment(1, { oversized: true, sealed: true }),
    segment(2, { sealed: true }),
    segment(3),
  ]);
  assert.equal(index.segments[0].sealed, false);
  assert.deepEqual(result.repaired, [segment(1).file, segment(2).file, segment(3).file]);
  assert.deepEqual(
    reconcileExecutionSegmentIndex(result.index, result.index.segments).repaired,
    [],
  );
});

for (const entries of [[segment(2)], [segment(1), segment(3)]]) {
  test(`recovery rejects a missing segment in ${entries.map(({ sequence }) => sequence).join(",")}`, () => {
    assert.throws(() => reconcileExecutionSegmentIndex(createTurnExecutionIndex([]), entries), {
      code: "EXECUTION_EVENT_INDEX_CORRUPTED",
    });
  });
}

test("recovery rejects missing and duplicate summary facts", () => {
  const index = createTurnExecutionIndex([segment(1)]);
  assert.throws(() => reconcileExecutionSegmentIndex(index, []), TypeError);
  assert.throws(() => reconcileExecutionSegmentIndex(index, [segment(1), segment(1)]), TypeError);
});
