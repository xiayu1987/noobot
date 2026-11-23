/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PARTITION_CONTENT_CHUNK_BYTES,
  encodePartitionContentChunk,
  encodePartitionContentRange,
  requirePartitionContentRange,
  splitPartitionContent,
} from "../src/partition-message-content.js";

const units = [
  "a",
  '"',
  "\\",
  "\b",
  "\t",
  "\n",
  "\f",
  "\r",
  "\0",
  "\x1f",
  "é",
  "中",
  "🚀",
  "\ud800",
  "\udfff",
];

for (const unit of units) {
  test(`content blocks bound canonical JSON bytes for ${JSON.stringify(unit)}`, () => {
    const content = unit.repeat(PARTITION_CONTENT_CHUNK_BYTES + 1);
    const blocks = splitPartitionContent(content);
    assert.ok(blocks.length > 1);
    assert.equal(blocks.join(""), content);
    assert.deepEqual(
      Buffer.concat(blocks.map((block) => Buffer.from(encodePartitionContentChunk(block)))),
      Buffer.from(JSON.stringify(content).slice(1, -1)),
    );
    let offset = 1;
    for (const block of blocks) {
      const range = requirePartitionContentRange(encodePartitionContentRange(offset, block), {
        contentBytes: Buffer.byteLength(JSON.stringify(content)),
      });
      assert.ok(range.byteLength > 0 && range.byteLength <= PARTITION_CONTENT_CHUNK_BYTES);
      offset += range.byteLength;
    }
    assert.equal(offset + 1, Buffer.byteLength(JSON.stringify(content)));
  });
}

test("content block boundaries retain surrogate pairs and explicit empty blocks", () => {
  assert.deepEqual(splitPartitionContent(""), [""]);
  const prefix = "x".repeat(PARTITION_CONTENT_CHUNK_BYTES - 1);
  assert.deepEqual(splitPartitionContent(`${prefix}🚀`), [prefix, "🚀"]);
  assert.deepEqual(splitPartitionContent("x".repeat(PARTITION_CONTENT_CHUNK_BYTES)), [
    "x".repeat(PARTITION_CONTENT_CHUNK_BYTES),
  ]);
  assert.throws(() => splitPartitionContent(null), { code: "SESSION_STORAGE_CORRUPT" });
  assert.throws(
    () =>
      requirePartitionContentRange([1, "x".repeat(PARTITION_CONTENT_CHUNK_BYTES + 1)], {
        contentBytes: Number.MAX_SAFE_INTEGER,
      }),
    { code: "SESSION_STORAGE_CORRUPT" },
  );
});
