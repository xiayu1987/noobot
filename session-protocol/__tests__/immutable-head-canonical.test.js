/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  IMMUTABLE_CURRENT_SESSION_FORMAT as format,
  encodeImmutableSessionHead,
  decodeImmutableSessionHead,
  requireImmutableCleanupHead,
} from "../src/immutable-storage.js";
import { IMMUTABLE_SEGMENT, encodeImmutableRecordReference } from "../src/immutable-segment.js";

function head() {
  return {
    format,
    sessionId: "canonical-head",
    generation: 1,
    root: "a".repeat(64),
    operations: "b".repeat(64),
    commit: "c".repeat(64),
    segmentTail: { segmentId: "d".repeat(32), end: 128 },
    locationRoot: encodeImmutableRecordReference({
      segmentId: "d".repeat(32),
      offset: IMMUTABLE_SEGMENT.magic.length,
      length: 32,
      digest: "e".repeat(64),
    }),
  };
}

test("head identity is independent of field insertion order including the append boundary", async () => {
  const source = head();
  const reordered = Object.fromEntries(Object.entries(source).toReversed());
  reordered.segmentTail = { end: source.segmentTail.end, segmentId: source.segmentTail.segmentId };
  assert.equal(
    encodeImmutableSessionHead(reordered, format),
    encodeImmutableSessionHead(source, format),
  );
  await requireImmutableCleanupHead(source, reordered);
  await assert.rejects(
    requireImmutableCleanupHead(source, { ...reordered, commit: "f".repeat(64) }),
    {
      code: "SESSION_MAINTENANCE_PLAN_STALE",
    },
  );
});

test("previously checksummed heads decode exactly and re-encode to canonical field order", () => {
  const source = head();
  const reordered = Object.fromEntries(Object.entries(source).toReversed());
  const payload = JSON.stringify(reordered);
  const raw = JSON.stringify({
    payload,
    checksum: createHash("sha256").update(payload).digest("hex"),
  });
  const decoded = decodeImmutableSessionHead(raw, source.sessionId, format);
  assert.deepEqual(decoded, source);
  assert.equal(
    encodeImmutableSessionHead(decoded, format),
    encodeImmutableSessionHead(source, format),
  );
});
