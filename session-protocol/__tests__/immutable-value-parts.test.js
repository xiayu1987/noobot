/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  IMMUTABLE_VALUE_BLOCK_BYTES,
  immutableInlineValueParts,
  immutablePageReferences,
  requireImmutableValueParts,
} from "../src/immutable-storage-graph.js";

const reference = "a".repeat(64);
const parts = [{ path: ["message", "content"], reference }];
const value = { message: { content: null }, metadata: "" };
const invalid = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };

test("inline metadata uses the protocol byte budget including UTF-8 and part descriptors", () => {
  const overhead = Buffer.byteLength(JSON.stringify(immutableInlineValueParts(value, parts)));
  const exact = { ...value, metadata: "x".repeat(IMMUTABLE_VALUE_BLOCK_BYTES - overhead) };
  const page = immutableInlineValueParts(exact, parts);
  assert.equal(Buffer.byteLength(JSON.stringify(page)), IMMUTABLE_VALUE_BLOCK_BYTES);
  assert.equal(requireImmutableValueParts(page), page);
  assert.equal(
    immutableInlineValueParts({ ...exact, metadata: exact.metadata + "x" }, parts),
    null,
  );
  assert.equal(
    immutableInlineValueParts({ ...exact, metadata: exact.metadata.slice(1) + "中" }, parts),
    null,
  );
  assert.deepEqual(immutablePageReferences(page), [reference]);
  assert.deepEqual(immutablePageReferences({ kind: "value-parts", template: reference, parts }), [
    reference,
    reference,
  ]);
});

test("inline metadata rejects malformed envelopes, paths, references and oversized values", () => {
  const page = immutableInlineValueParts(value, parts);
  for (const corrupt of [
    { ...page, value: null },
    { ...page, value: [] },
    { ...page, template: reference },
    { ...page, extra: true },
    { ...page, parts: [] },
    { ...page, parts: [...parts, ...parts] },
    { ...page, parts: [{ ...parts[0], path: ["message", "unknown"] }] },
    { ...page, parts: [{ ...parts[0], reference: "invalid" }] },
    { ...page, value: { ...value, metadata: "x".repeat(IMMUTABLE_VALUE_BLOCK_BYTES) } },
  ]) {
    assert.throws(() => requireImmutableValueParts(corrupt), invalid);
    assert.throws(() => immutablePageReferences(corrupt), invalid);
  }
});
