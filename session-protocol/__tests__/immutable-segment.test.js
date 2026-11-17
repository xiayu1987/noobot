/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  IMMUTABLE_SEGMENT,
  decodeImmutableRecordReference,
  encodeImmutableRecordReference,
  requireImmutableRecordReference,
  requireImmutableSegmentId,
  requireImmutableContentDigest,
} from "../src/immutable-segment.js";

const record = {
  segmentId: "a".repeat(32),
  offset: IMMUTABLE_SEGMENT.magic.length,
  length: 17,
  digest: "b".repeat(64),
};

test("physical references round trip with an independent content digest", () => {
  const reference = encodeImmutableRecordReference(record);
  assert.deepEqual(decodeImmutableRecordReference(reference), record);
  for (const length of [0, IMMUTABLE_SEGMENT.recordBytes])
    assert.deepEqual(
      decodeImmutableRecordReference(encodeImmutableRecordReference({ ...record, length })),
      { ...record, length },
    );
});

test("record references reject aliases, traversal, noncanonical numbers and overflow", () => {
  const reference = encodeImmutableRecordReference(record);
  for (const invalid of [
    null,
    record,
    record.digest,
    `../${reference}`,
    reference.toUpperCase(),
    reference.replace(":17:", ":017:"),
    reference.replace(":17:", ":1e1:"),
    reference.replace(`:${record.offset}:`, ":9007199254740993:"),
    `${reference}\n`,
    `${reference}\r\n`,
    reference.replace(`:${record.offset}:`, `:0${record.offset}:`),
    reference.replace(":17:", ":-0:"),
    reference.replace(":17:", ":0.0:"),
    reference.replace(`:${record.offset}:`, `:${IMMUTABLE_SEGMENT.bytes}:`),
    `${record.segmentId}:${record.offset}:${IMMUTABLE_SEGMENT.recordBytes + 1}:${record.digest}`,
    reference.replace(`:${record.offset}:`, ":0:"),
    reference.replace(`:${record.offset}:`, `:${IMMUTABLE_SEGMENT.bytes - 1}:`),
    `${"a".repeat(31)}:${record.offset}:17:${"b".repeat(65)}`,
    `${"a".repeat(33)}:${record.offset}:17:${"b".repeat(63)}`,
    `${reference}${"a".repeat(100000)}`,
  ]) {
    assert.throws(() => decodeImmutableRecordReference(invalid), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
    assert.throws(() => requireImmutableRecordReference(invalid), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
  }
  for (const change of [
    { offset: 0 },
    { offset: IMMUTABLE_SEGMENT.bytes },
    { length: -1 },
    { length: IMMUTABLE_SEGMENT.recordBytes + 1 },
    { length: 0.5 },
    { digest: "bad" },
    { segmentId: "../outside" },
  ])
    assert.throws(() => encodeImmutableRecordReference({ ...record, ...change }), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
});

test("reference range validation permits the exact segment end and empty records", () => {
  for (const range of [
    { offset: IMMUTABLE_SEGMENT.bytes, length: 0 },
    {
      offset: IMMUTABLE_SEGMENT.bytes - IMMUTABLE_SEGMENT.recordBytes,
      length: IMMUTABLE_SEGMENT.recordBytes,
    },
    { offset: IMMUTABLE_SEGMENT.magic.length, length: 0 },
  ]) {
    const value = { ...record, ...range };
    assert.deepEqual(decodeImmutableRecordReference(encodeImmutableRecordReference(value)), value);
  }
});

test("hex identities require exact lengths and reject trailing line terminators", () => {
  for (const [validate, length] of [
    [requireImmutableSegmentId, 32],
    [requireImmutableContentDigest, 64],
  ]) {
    const value = "abcdef0123456789".repeat(length / 16);
    assert.equal(validate(value), value);
    for (const invalid of [
      null,
      value.slice(1),
      `${value}a`,
      `${value}\n`,
      `${value}\r\n`,
      value.toUpperCase(),
    ])
      assert.throws(() => validate(invalid), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  }
});
