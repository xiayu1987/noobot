/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  IMMUTABLE_READER_RETENTION as RETENTION,
  IMMUTABLE_SESSION_FORMAT,
  IMMUTABLE_SEGMENT_SESSION_FORMAT,
  encodeImmutableCleanupRecord,
  encodeImmutableReaderRetention,
  decodeImmutableReaderRetentionBytes,
} from "../src/immutable-storage.js";
import { IMMUTABLE_SEGMENT, encodeImmutableRecordReference } from "../src/immutable-segment.js";

const id = "00000000-0000-0000-0000-000000000001";
const invalid = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };

function recordFor(format) {
  const digest = "a".repeat(64);
  const reference =
    format === IMMUTABLE_SESSION_FORMAT
      ? digest
      : encodeImmutableRecordReference({
          segmentId: "b".repeat(32),
          offset: IMMUTABLE_SEGMENT.magic.length,
          length: 17,
          digest,
        });
  return {
    format: RETENTION.format,
    id,
    head: {
      format,
      sessionId: "保留-\ufffd",
      generation: 1,
      root: reference,
      operations: reference,
      commit: reference,
      ...(format === IMMUTABLE_SEGMENT_SESSION_FORMAT ? { segmentTail: null } : {}),
    },
  };
}

for (const format of [IMMUTABLE_SESSION_FORMAT, IMMUTABLE_SEGMENT_SESSION_FORMAT]) {
  test(`${format} retention bytes enforce the same exact limit on write and read`, () => {
    const record = recordFor(format);
    const available =
      RETENTION.recordBytes - Buffer.byteLength(encodeImmutableReaderRetention(record, id, format));
    record.head.sessionId += "x".repeat(available);
    const bytes = Buffer.from(encodeImmutableReaderRetention(record, id, format));
    assert.equal(bytes.length, RETENTION.recordBytes);
    assert.deepEqual(decodeImmutableReaderRetentionBytes(bytes, id, format), record);
    record.head.sessionId += "x";
    assert.throws(() => encodeImmutableReaderRetention(record, id, format), invalid);
    const oversized = Buffer.from(encodeImmutableCleanupRecord(record));
    assert.equal(oversized.length, RETENTION.recordBytes + 1);
    assert.throws(() => decodeImmutableReaderRetentionBytes(oversized, id, format), invalid);
  });

  test(`${format} retention decoding preserves byte view boundaries across realms`, () => {
    const record = recordFor(format);
    const bytes = Buffer.from(encodeImmutableReaderRetention(record, id, format));
    const padded = Buffer.concat([Buffer.from([0xff]), bytes, Buffer.from([0xff])]);
    const views = [
      padded.subarray(1, -1),
      new DataView(padded.buffer, padded.byteOffset + 1, bytes.length),
      runInNewContext("new Uint8Array(bytes)", { bytes }),
    ];
    for (const view of views)
      assert.deepEqual(decodeImmutableReaderRetentionBytes(view, id, format), record);
    assert.throws(() => decodeImmutableReaderRetentionBytes(padded, id, format), invalid);
  });

  test(`${format} retention rejects invalid encoding, identity and format without weakening the envelope`, () => {
    const record = recordFor(format);
    const bytes = Buffer.from(encodeImmutableReaderRetention(record, id, format));
    const offset = bytes.indexOf(Buffer.from("\ufffd"));
    const damaged = Buffer.concat([
      bytes.subarray(0, offset),
      Buffer.from([0xff]),
      bytes.subarray(offset + 3),
    ]);
    for (const input of [
      damaged,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
      bytes.toString(),
      undefined,
    ])
      assert.throws(() => decodeImmutableReaderRetentionBytes(input, id, format), invalid);
    const otherId = "00000000-0000-0000-0000-000000000002";
    assert.throws(() => decodeImmutableReaderRetentionBytes(bytes, otherId, format), invalid);
    assert.throws(() => encodeImmutableReaderRetention(record, otherId, format), invalid);
    assert.throws(() => decodeImmutableReaderRetentionBytes(bytes, id, "unknown"), invalid);
    const unknown = { ...record, extra: true };
    assert.throws(() => encodeImmutableReaderRetention(unknown, id, format), invalid);
    assert.throws(
      () =>
        decodeImmutableReaderRetentionBytes(
          Buffer.from(encodeImmutableCleanupRecord(unknown)),
          id,
          format,
        ),
      invalid,
    );
  });
}
