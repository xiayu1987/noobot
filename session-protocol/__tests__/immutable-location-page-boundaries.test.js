/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeImmutableLocationPage,
  decodeImmutableLocationPage,
} from "../src/immutable-location-page.js";
import { encodeImmutableRecordReference, IMMUTABLE_SEGMENT } from "../src/immutable-segment.js";
import { IMMUTABLE_VALUE_BLOCK_BYTES } from "../src/immutable-value-limits.js";

function location(digit, segmentId = "a".repeat(32)) {
  return encodeImmutableRecordReference({
    segmentId,
    offset: IMMUTABLE_SEGMENT.magic.length,
    length: 12,
    digest: digit.repeat(64),
  });
}
const leaf = { kind: "index-leaf", entries: [["b".repeat(64), location("b")]] };
const invalid = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };

test("location pages share segment and digest facts without changing physical references", () => {
  const branch = {
    kind: "index-branch",
    depth: 0,
    children: Object.fromEntries([..."0123456789abcdef"].map((digit) => [digit, location(digit)])),
  };
  for (const page of [leaf, branch]) {
    const bytes = encodeImmutableLocationPage(page);
    assert.deepEqual(decodeImmutableLocationPage(bytes), page);
    assert.ok(bytes.length < Buffer.byteLength(JSON.stringify(page)));
    assert.equal(JSON.parse(bytes.toString())[2].length, 1);
  }
});

test("location pages reject duplicate keys, unused segments, mismatched identities and invalid ranges", () => {
  const wire = JSON.parse(encodeImmutableLocationPage(leaf).toString());
  for (const mutate of [
    (value) => value[3].push(value[3][0]),
    (value) => value[2].push("c".repeat(32)),
    (value) => value[3][0].splice(1, 1, 2),
    (value) => value[3][0].splice(2, 1, -1),
    (value) => value[3][0].push("ignored"),
  ]) {
    const changed = structuredClone(wire);
    mutate(changed);
    assert.throws(() => decodeImmutableLocationPage(Buffer.from(JSON.stringify(changed))), invalid);
  }
  assert.throws(
    () => encodeImmutableLocationPage({ ...leaf, entries: [["c".repeat(64), location("b")]] }),
    invalid,
  );
});

test("location page decoding enforces canonical bytes, key order and first-use segment slots", () => {
  const page = {
    kind: "index-leaf",
    entries: [
      ["b".repeat(64), location("b")],
      ["c".repeat(64), location("c", "d".repeat(32))],
    ],
  };
  const bytes = encodeImmutableLocationPage(page);
  const wire = JSON.parse(bytes.toString());
  assert.deepEqual(decodeImmutableLocationPage(bytes), page);
  for (const mutate of [
    (value) => value[3].reverse(),
    (value) => {
      value[2].reverse();
      value[3][0][1] = 1;
      value[3][1][1] = 0;
    },
    (value) => (value[2][1] = value[2][0]),
    (value) => (value[3][0][0] = "B".repeat(64)),
    (value) => (value[3] = []),
    (value) => (value[3][0][2] = IMMUTABLE_SEGMENT.bytes),
    (value) => (value[3][0][3] = IMMUTABLE_SEGMENT.recordBytes + 1),
  ]) {
    const changed = structuredClone(wire);
    mutate(changed);
    assert.throws(() => decodeImmutableLocationPage(Buffer.from(JSON.stringify(changed))), invalid);
  }
  for (const text of [
    ` ${bytes.toString()}`,
    JSON.stringify(wire, null, 2),
    bytes.toString().replace(",0,", ",-0,"),
    bytes.toString().replace("noobot", "\\u006eoobot"),
  ]) {
    assert.throws(() => decodeImmutableLocationPage(Buffer.from(text)), invalid);
  }
});

test("location page canonical validation rejects malformed UTF-8 and non-ASCII fields", () => {
  const bytes = encodeImmutableLocationPage(leaf);
  const keyOffset = bytes.indexOf(Buffer.from("b".repeat(64)));
  assert.ok(keyOffset > 0);
  for (const replacement of [
    Buffer.from([0xff]),
    Buffer.from([0xc1, 0xa2]),
    Buffer.from([0xe2, 0x82]),
    Buffer.from("\uFFFD"),
    Buffer.from("é"),
  ]) {
    const corrupted = Buffer.concat([
      bytes.subarray(0, keyOffset),
      replacement,
      bytes.subarray(keyOffset + 1),
    ]);
    assert.throws(() => decodeImmutableLocationPage(corrupted), invalid);
  }
});

test("location page wire size is bounded before JSON decoding", () => {
  const page = {
    kind: "index-leaf",
    entries: Array.from({ length: 1200 }, (_, i) => {
      const digest = i.toString(16).padStart(64, "0");
      return [
        digest,
        encodeImmutableRecordReference({
          segmentId: "a".repeat(32),
          offset: IMMUTABLE_SEGMENT.magic.length,
          length: 12,
          digest,
        }),
      ];
    }),
  };
  const bytes = Buffer.from(
    JSON.stringify([
      "noobot.location-page/1",
      null,
      ["a".repeat(32)],
      page.entries.map(([digest]) => [digest, 0, IMMUTABLE_SEGMENT.magic.length, 12]),
    ]),
  );
  assert.ok(bytes.length > IMMUTABLE_VALUE_BLOCK_BYTES);
  assert.throws(() => decodeImmutableLocationPage(bytes), invalid);
  assert.throws(() => encodeImmutableLocationPage(page), invalid);
});
