/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createImmutableSegmentRecordEncoder,
  encodeImmutableRecordReference,
  IMMUTABLE_SEGMENT,
} from "../src/immutable-segment.js";

const segmentId = "a".repeat(32);
const digest = "b".repeat(64);
const invalid = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };

test("a shared segment encoder retains canonical references and per-record validation", () => {
  const encode = createImmutableSegmentRecordEncoder(segmentId);
  for (const [offset, length] of [
    [IMMUTABLE_SEGMENT.magic.length, 0],
    [IMMUTABLE_SEGMENT.magic.length, IMMUTABLE_SEGMENT.recordBytes],
    [IMMUTABLE_SEGMENT.bytes, 0],
  ]) {
    assert.equal(
      encode(offset, length, digest),
      encodeImmutableRecordReference({ segmentId, offset, length, digest }),
    );
  }
  for (const [offset, length, identity] of [
    [0, 1, digest],
    [IMMUTABLE_SEGMENT.bytes, 1, digest],
    [IMMUTABLE_SEGMENT.magic.length, -1, digest],
    [IMMUTABLE_SEGMENT.magic.length, IMMUTABLE_SEGMENT.recordBytes + 1, digest],
    [IMMUTABLE_SEGMENT.magic.length, 1, "B".repeat(64)],
    [IMMUTABLE_SEGMENT.magic.length, 1, digest + "\n"],
    [NaN, 1, digest],
  ])
    assert.throws(() => encode(offset, length, identity), invalid);
  assert.equal(
    encode(IMMUTABLE_SEGMENT.magic.length, 1, digest),
    encodeImmutableRecordReference({
      segmentId,
      offset: IMMUTABLE_SEGMENT.magic.length,
      length: 1,
      digest,
    }),
  );
});

test("a shared segment encoder rejects invalid identities before accepting records", () => {
  for (const identity of [null, 42, "", "a".repeat(31), "A".repeat(32), segmentId + "\n"])
    assert.throws(() => createImmutableSegmentRecordEncoder(identity), invalid);
});
