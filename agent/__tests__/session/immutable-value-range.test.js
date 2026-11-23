/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { IMMUTABLE_VALUE_BLOCK_BYTES } from "@noobot/session-protocol/immutable-storage-graph";
import { readImmutableValueRange } from "../../src/session/session-artifact-session/immutable-value-range.js";

function fixture() {
  const size = IMMUTABLE_VALUE_BLOCK_BYTES;
  const pages = new Map([
    ["root", { kind: "value-branch", bytes: size * 4, left: "left", right: "right" }],
    ["left", { kind: "value-branch", bytes: size * 2, left: "a", right: "b" }],
    ["right", { kind: "value-branch", bytes: size * 2, left: "c", right: "d" }],
    ...["a", "b", "c", "d"].map((key) => [
      key,
      { kind: "value", bytes: size, data: key + "-data" },
    ]),
  ]);
  const reads = [];
  const objects = {
    requireReference(ref) {
      assert.ok(typeof ref === "string" && ref.length > 0);
    },
    async readPage(ref) {
      reads.push(ref);
      return pages.get(ref);
    },
    async read(ref) {
      reads.push(ref);
      return Buffer.alloc(size, ref.charCodeAt(0));
    },
  };
  return { size, pages, reads, objects };
}

test("tail ranges skip earlier bodies and descendants instead of streaming the prefix", async () => {
  const { size, reads, objects } = fixture();
  const result = await readImmutableValueRange(objects, "root", {
    offset: size * 3 + 2,
    length: 9,
  });
  assert.equal(result.totalBytes, size * 4);
  assert.deepEqual(result.bytes, Buffer.alloc(9, "d"));
  assert.deepEqual(reads, ["root", "left", "right", "c", "d", "d-data"]);
});

test("ranges cross blocks, clamp at EOF, and allow an empty EOF page", async () => {
  const { size, objects } = fixture();
  const cross = await readImmutableValueRange(objects, "root", { offset: size * 2 - 3, length: 8 });
  assert.equal(cross.bytes.toString(), "bbbccccc");
  const last = await readImmutableValueRange(objects, "root", { offset: size * 4 - 2, length: 8 });
  assert.equal(last.bytes.toString(), "dd");
  assert.equal(
    (await readImmutableValueRange(objects, "root", { offset: size * 4, length: 8 })).bytes.length,
    0,
  );
  await assert.rejects(
    readImmutableValueRange(objects, "root", { offset: size * 4 + 1, length: 8 }),
    RangeError,
  );
});

test("range traversal rejects inconsistent child sizes and truncated payloads", async () => {
  const { size, pages, objects } = fixture();
  pages.get("left").bytes -= 1;
  await assert.rejects(readImmutableValueRange(objects, "root", { offset: size * 3, length: 1 }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  pages.get("left").bytes += 1;
  objects.read = async () => Buffer.alloc(1);
  await assert.rejects(readImmutableValueRange(objects, "root", { offset: size * 3, length: 1 }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
});

test("range traversal honors cancellation and validates integer bounds", async () => {
  const { objects, reads } = fixture();
  for (const bounds of [
    { offset: -1, length: 1 },
    { offset: 0, length: -1 },
    { offset: 0.5, length: 1 },
  ])
    await assert.rejects(readImmutableValueRange(objects, "root", bounds), TypeError);
  assert.equal(reads.length, 0);
  const signal = AbortSignal.abort(new Error("stop"));
  await assert.rejects(
    readImmutableValueRange(objects, "root", { offset: 0, length: 1, signal }),
    /stop/,
  );
  assert.equal(reads.length, 0);
});
