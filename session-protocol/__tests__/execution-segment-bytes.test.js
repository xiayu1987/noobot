/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { decodeExecutionSegmentRecordBytes } from "../src/aggregate/execution-event-index.js";

const file = "segment-000001.jsonl";
const turn = "byte-decoder-turn";
const record = { dialogProcessId: turn, content: "中文🙂�" };
const encoded = new TextEncoder().encode(JSON.stringify(record));

test("byte decoder preserves valid UTF-8 and requires the declared turn identity", () => {
  assert.deepEqual(decodeExecutionSegmentRecordBytes(encoded, file, turn), record);
  assert.throws(() => decodeExecutionSegmentRecordBytes(encoded, file, "foreign-turn"), {
    code: "EXECUTION_EVENT_JSONL_CORRUPTED",
  });
  assert.throws(() => decodeExecutionSegmentRecordBytes("{}", file), TypeError);
});

for (const broken of [
  [0x80],
  [0xc0, 0xaf],
  [0xc3, 0x28],
  [0xe2, 0x82],
  [0xed, 0xa0, 0x80],
  [0xf4, 0x90, 0x80, 0x80],
]) {
  test(`byte decoder rejects malformed source ${broken.join(",")} and stays usable`, () => {
    const bytes = Uint8Array.from([
      ...new TextEncoder().encode('{"content":"'),
      ...broken,
      ...new TextEncoder().encode('"}'),
    ]);
    assert.throws(
      () => decodeExecutionSegmentRecordBytes(bytes, file),
      (error) =>
        error.code === "EXECUTION_EVENT_JSONL_CORRUPTED" &&
        error.cause instanceof TypeError &&
        error.message.includes(file),
    );
    assert.deepEqual(decodeExecutionSegmentRecordBytes(encoded, file, turn), record);
  });
}

test("byte decoder rejects a BOM instead of silently removing authoritative bytes", () => {
  const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...encoded]);
  assert.throws(() => decodeExecutionSegmentRecordBytes(bytes, file, turn), {
    code: "EXECUTION_EVENT_JSONL_CORRUPTED",
  });
});
