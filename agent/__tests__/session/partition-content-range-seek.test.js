/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PARTITION_CONTENT_CHUNK_BYTES } from "@noobot/session-protocol/partition-message-content";
import { readPartitionContentRange } from "../../src/session/partition-storage/partition-message-content.js";

for (const largeAt of [0, 500, 999]) {
  test(`byte range seek remains logarithmic with a large chunk at ${largeAt}`, async () => {
    let offset = 1;
    const ranges = Array.from({ length: 1000 }, (_, index) => {
      const content = "x".repeat(index === largeAt ? PARTITION_CONTENT_CHUNK_BYTES : 1);
      const value = [offset, content];
      offset += content.length;
      return value;
    });
    const record = {
      message: { messageUid: "message" },
      firstChunk: 1,
      firstByteChunk: 1,
      lastChunk: ranges.length,
      contentBytes: offset + 1,
    };
    for (const index of [1, 333, 666, 998]) {
      let probes = 0;
      const bytes = await readPartitionContentRange(
        async ({ keys }) => {
          probes += keys.length;
          return new Map(keys.map((key) => [key, { value: ranges[JSON.parse(key)[1] - 1] }]));
        },
        record,
        { byteOffset: ranges[index][0], maxBytes: 1 },
      );
      assert.equal(Buffer.from(bytes).toString(), "x");
      assert.ok(probes <= 2 + Math.ceil(Math.log2(ranges.length)), `${probes} probes at ${index}`);
    }
  });
}
