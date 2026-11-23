/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  IMMUTABLE_SESSION_FORMAT,
  IMMUTABLE_SEALED_SEGMENT_SESSION_FORMAT,
  IMMUTABLE_SEGMENT_SESSION_FORMAT,
  encodeImmutableSessionHead,
  decodeImmutableSessionHead,
} from "../src/immutable-storage.js";
import {
  IMMUTABLE_JSON_LOCATED_SESSION_FORMAT,
  IMMUTABLE_LOCATED_SESSION_FORMAT,
} from "../src/immutable-record-location.js";
import { IMMUTABLE_SEGMENT, encodeImmutableRecordReference } from "../src/immutable-segment.js";
import { immutableValueIndexReferences } from "../src/immutable-storage-graph.js";

function head() {
  return {
    format: IMMUTABLE_SESSION_FORMAT,
    sessionId: "session-1",
    generation: 1,
    root: "a".repeat(64),
    operations: "b".repeat(64),
    commit: "c".repeat(64),
  };
}
const invalid = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };

test("immutable head has one exact checksummed identity contract", () => {
  const source = head();
  const raw = encodeImmutableSessionHead(source);
  assert.deepEqual(decodeImmutableSessionHead(raw, source.sessionId), source);
  assert.throws(() => decodeImmutableSessionHead(raw, "another-session"), invalid);
  assert.throws(() => decodeImmutableSessionHead(raw.replace("session-1", "session-2")), invalid);
  assert.throws(() => decodeImmutableSessionHead("{"), invalid);
  assert.throws(() => decodeImmutableSessionHead(" ".repeat(16384)), invalid);
  assert.throws(() => encodeImmutableSessionHead({ ...source, generation: 0 }), invalid);
  assert.throws(() => encodeImmutableSessionHead({ ...source, metadata: {} }), invalid);
  assert.throws(() => encodeImmutableSessionHead({ ...source, commit: null }), invalid);
  assert.throws(
    () => encodeImmutableSessionHead({ ...source, sessionId: "x".repeat(16384) }),
    invalid,
  );
});

for (const format of [
  IMMUTABLE_SESSION_FORMAT,
  IMMUTABLE_SEALED_SEGMENT_SESSION_FORMAT,
  IMMUTABLE_SEGMENT_SESSION_FORMAT,
  IMMUTABLE_JSON_LOCATED_SESSION_FORMAT,
  IMMUTABLE_LOCATED_SESSION_FORMAT,
]) {
  test(`${format} head identity ignores property order and verifies existing wire bytes`, () => {
    const source = { ...head(), format };
    const physical = encodeImmutableRecordReference({
      segmentId: "d".repeat(32),
      offset: IMMUTABLE_SEGMENT.magic.length,
      length: 32,
      digest: "e".repeat(64),
    });
    if (
      [IMMUTABLE_SEALED_SEGMENT_SESSION_FORMAT, IMMUTABLE_SEGMENT_SESSION_FORMAT].includes(format)
    )
      Object.assign(source, { root: physical, operations: physical, commit: physical });
    if (format === IMMUTABLE_SEGMENT_SESSION_FORMAT)
      source.segmentTail = { segmentId: "d".repeat(32), end: 128 };
    if ([IMMUTABLE_JSON_LOCATED_SESSION_FORMAT, IMMUTABLE_LOCATED_SESSION_FORMAT].includes(format))
      Object.assign(source, {
        locationRoot: physical,
        segmentTail: { segmentId: "d".repeat(32), end: 128 },
      });
    const reordered = Object.fromEntries(Object.entries(source).reverse());
    if (source.segmentTail)
      reordered.segmentTail = Object.fromEntries(Object.entries(source.segmentTail).reverse());
    const raw = encodeImmutableSessionHead(source, format);
    assert.equal(raw, encodeImmutableSessionHead(reordered, format));

    const payload = JSON.stringify(reordered);
    const existing = JSON.stringify({
      payload,
      checksum: createHash("sha256").update(payload).digest("hex"),
    });
    assert.deepEqual(decodeImmutableSessionHead(existing, source.sessionId, format), source);
    assert.equal(encodeImmutableSessionHead(decodeImmutableSessionHead(existing), format), raw);
    assert.throws(
      () => decodeImmutableSessionHead(existing.replace("session-1", "session-2")),
      invalid,
    );
    assert.notEqual(encodeImmutableSessionHead({ ...source, generation: 2 }, format), raw);
    if (source.segmentTail)
      assert.notEqual(
        encodeImmutableSessionHead(
          {
            ...source,
            segmentTail: { ...source.segmentTail, end: 129 },
          },
          format,
        ),
        raw,
      );
  });
}

test("graph contract distinguishes pointers from opaque content and rejects invalid descriptors", () => {
  const reference = "a".repeat(64);
  assert.deepEqual(immutableValueIndexReferences("messages", "uid", { root: reference }), []);
  assert.deepEqual(
    immutableValueIndexReferences("turnOutbox", "turn", { root: reference, count: 1 }),
    [{ reference, role: "scalar", count: 1 }],
  );
  assert.throws(() => immutableValueIndexReferences("turns", "turn", null), invalid);
  assert.throws(
    () => immutableValueIndexReferences("turnOutbox", "turn", { root: null, count: 1 }),
    invalid,
  );
  assert.throws(
    () => immutableValueIndexReferences("turnOutbox", "turn", { root: reference }),
    invalid,
  );
});

test("context source graph validates its bounded directory and count through one contract", () => {
  const reference = "a".repeat(64);
  const descriptor = { count: 2, root: reference, directory: { ordinals: [1, 5] } };
  const read = (value) => immutableValueIndexReferences("contextSources", "turn", value);
  assert.deepEqual(read(descriptor), [{ reference, role: "messages", count: 2 }]);
  assert.deepEqual(read({ count: 0, root: null, directory: { ordinals: [] } }), [
    { reference: null, role: "messages", count: 0 },
  ]);
  for (const value of [
    { count: 2, root: reference },
    { ...descriptor, extra: true },
    { ...descriptor, count: 1 },
    { ...descriptor, count: 3 },
    { ...descriptor, directory: { ordinals: [5, 1] } },
    { ...descriptor, directory: { slots: [] } },
    { ...descriptor, directory: { slots: [0, 1, 2] } },
    { ...descriptor, root: null },
  ])
    assert.throws(() => read(value), invalid);
});
