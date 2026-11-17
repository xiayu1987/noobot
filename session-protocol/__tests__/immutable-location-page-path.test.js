/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  encodeImmutableLocationPage,
  decodeImmutableLocationPage,
  requireImmutableLocationPagePath,
} from "../src/immutable-location-page.js";
import { encodeImmutableRecordReference, IMMUTABLE_SEGMENT } from "../src/immutable-segment.js";
import { IMMUTABLE_VALUE_BLOCK_BYTES } from "../src/immutable-value-limits.js";

const invalid = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };
const identity = "b".repeat(64);
const reference = encodeImmutableRecordReference({
  segmentId: "a".repeat(32),
  offset: IMMUTABLE_SEGMENT.magic.length,
  length: 12,
  digest: identity,
});
const leaf = { kind: "index-leaf", entries: [[identity, reference]] };
const hash = createHash("sha256").update(identity).digest("hex");

test("location path binding retains leaf hash membership after physical decoding", () => {
  const decoded = decodeImmutableLocationPage(encodeImmutableLocationPage(leaf));
  for (const prefix of ["", hash.slice(0, 1), hash.slice(0, 32), hash])
    assert.equal(requireImmutableLocationPagePath(decoded, prefix), decoded);
  const wrong = hash[0] === "a" ? "b" : "a";
  for (const prefix of [wrong, `${hash.slice(0, 63)}${wrong}`]) {
    if (hash.startsWith(prefix)) continue;
    assert.throws(() => requireImmutableLocationPagePath(decoded, prefix), invalid);
  }
  for (const prefix of [null, 0, "g", "A", "a".repeat(65)])
    assert.throws(() => requireImmutableLocationPagePath(decoded, prefix), invalid);
});

test("location branch depth is bound to its exact radix traversal depth", () => {
  const branch = { kind: "index-branch", depth: 1, children: { a: reference } };
  const decoded = decodeImmutableLocationPage(encodeImmutableLocationPage(branch));
  assert.equal(requireImmutableLocationPagePath(decoded, "a"), decoded);
  for (const prefix of ["", "aa", "a".repeat(64)])
    assert.throws(() => requireImmutableLocationPagePath(decoded, prefix), invalid);
});

test("the codec remains responsible for identity and malformed physical references", () => {
  for (const entry of [
    [identity, "bad-reference"],
    ["c".repeat(64), reference],
    [identity.toUpperCase(), reference],
  ])
    assert.throws(() => encodeImmutableLocationPage({ ...leaf, entries: [entry] }), invalid);
});

test("compressed location leaves retain the logical index byte budget at its boundary", () => {
  const entries = [];
  let previous;
  for (let i = 0; i < 1000; i += 1) {
    const digest = i.toString(16).padStart(64, "0");
    entries.push([
      digest,
      encodeImmutableRecordReference({
        segmentId: "a".repeat(32),
        offset: IMMUTABLE_SEGMENT.magic.length,
        length: 12,
        digest,
      }),
    ]);
    const page = { kind: "index-leaf", entries };
    if (Buffer.byteLength(JSON.stringify(page)) <= IMMUTABLE_VALUE_BLOCK_BYTES) {
      previous = structuredClone(page);
      continue;
    }
    assert.ok(previous);
    const allowed = decodeImmutableLocationPage(encodeImmutableLocationPage(previous));
    assert.equal(requireImmutableLocationPagePath(allowed, ""), allowed);
    const oversized = decodeImmutableLocationPage(encodeImmutableLocationPage(page));
    assert.throws(() => requireImmutableLocationPagePath(oversized, ""), invalid);
    return;
  }
  assert.fail("fixture must reach the logical page limit before the wire limit");
});
