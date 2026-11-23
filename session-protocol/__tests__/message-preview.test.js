/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  decodeSessionMessagePreview,
  sessionMessagePreviewLimits,
} from "../src/message-preview.js";

const { chars, jsonBytes } = sessionMessagePreviewLimits();
function preview(content) {
  const encoded = Buffer.from(JSON.stringify(content));
  return decodeSessionMessagePreview(encoded.subarray(0, jsonBytes), encoded.length);
}

test("preview accepts Uint8Array bytes from another realm and rejects other views", () => {
  const bytes = runInNewContext("new Uint8Array([34, 104, 105, 34])");
  assert.equal(bytes instanceof Uint8Array, false);
  assert.deepEqual(decodeSessionMessagePreview(bytes, bytes.length), {
    content: "hi",
    contentTruncated: false,
  });
  for (const invalid of [
    new Int8Array(bytes),
    new Uint16Array(bytes),
    new DataView(bytes.buffer),
    { length: 0 },
  ]) {
    assert.throws(
      () => decodeSessionMessagePreview(invalid, invalid.byteLength),
      /Invalid message preview range/,
    );
  }
});

for (const content of ["", "hello", "x".repeat(chars), '\u0000\n\t"\\', "\ud800", "😀中文"]) {
  test(`complete preview preserves JSON string code units: ${JSON.stringify(content).slice(0, 40)}`, () => {
    assert.deepEqual(preview(content), { content, contentTruncated: false });
  });
}

for (const unit of ["x", "中", "😀", "\u0000", "\ud800", '"\\\n\t']) {
  test(`bounded preview decodes ${JSON.stringify(unit)} without reading the full JSON`, () => {
    const content = unit.repeat(10000);
    const result = preview(content);
    assert.equal(result.content, content.slice(0, chars));
    assert.equal(result.contentTruncated, true);
  });
}

test("preview does not split a surrogate pair at the character budget", () => {
  assert.deepEqual(preview(`${"a".repeat(chars - 1)}😀tail`), {
    content: "a".repeat(chars - 1),
    contentTruncated: true,
  });
  assert.deepEqual(preview(`${"a".repeat(chars - 1)}\ud800tail`), {
    content: `${"a".repeat(chars - 1)}\ud800`,
    contentTruncated: true,
  });
});

test("prefix tolerates a partial final UTF-8 character beyond the retained window", () => {
  const encoded = Buffer.from(JSON.stringify("中".repeat(10000)));
  for (let bytes = jsonBytes - 2; bytes <= jsonBytes; bytes += 1) {
    assert.deepEqual(decodeSessionMessagePreview(encoded.subarray(0, bytes), encoded.length), {
      content: "中".repeat(chars),
      contentTruncated: true,
    });
  }
});

for (const source of ['"\\q"', '"\\u00zz"', '"x"trailing', '"unterminated', '"\n"', "null", "[]"]) {
  test(`invalid complete JSON is rejected: ${JSON.stringify(source)}`, () => {
    const bytes = Buffer.from(source);
    assert.throws(() => decodeSessionMessagePreview(bytes, bytes.length));
  });
}

test("malformed ranges, early closing quotes and missing lookahead are rejected", () => {
  assert.throws(() => decodeSessionMessagePreview(Buffer.alloc(jsonBytes + 1), jsonBytes + 1));
  assert.throws(() => decodeSessionMessagePreview(Buffer.from('"hi"'), 100));
  assert.throws(() => decodeSessionMessagePreview(Buffer.from('"hi'), 100));
  assert.throws(() => decodeSessionMessagePreview(Buffer.from('"hi"'), 1));
  assert.throws(() => decodeSessionMessagePreview(Buffer.from([0x22, 0xff, 0x22]), 3));
});
