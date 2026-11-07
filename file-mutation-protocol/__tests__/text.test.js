/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { FILE_TEXT_ENCODINGS } from "../src/index.js";
import { decodeFileDocument, encodeFileText } from "../src/text-codec-node.js";

for (const encoding of FILE_TEXT_ENCODINGS) {
  test(`${encoding} round trips Unicode, BOM and mixed terminators`, () => {
    for (const content of ["", "中文😀\0\u0007\r\nnext\nlast", "\uFEFF中文\n"]) {
      const bytes = encodeFileText(content, encoding);
      assert.deepEqual(decodeFileDocument(bytes, encoding), { content, encoding });
      assert.deepEqual(
        encodeFileText(decodeFileDocument(bytes, encoding).content, encoding),
        bytes,
      );
    }
  });
}

for (const encoding of ["utf-8", "utf-16le", "utf-16be"]) {
  test(`auto resolves ${encoding} BOM without dropping it`, () => {
    const content = "\uFEFF中文\n";
    assert.deepEqual(decodeFileDocument(encodeFileText(content, encoding)), { content, encoding });
  });
}

test("encoding is explicit without a BOM and malformed inputs never get replaced", () => {
  assert.equal(decodeFileDocument(Buffer.from("plain")).encoding, "utf-8");
  assert.throws(() => decodeFileDocument(encodeFileText("中文", "gb18030")), /UTF-8/);
  for (const [encoding, bytes] of [
    ["utf-8", [0x61, 0xff]],
    ["utf-16le", [0x61]],
    ["utf-16be", [0xd8, 0x00]],
    ["gb18030", [0x81]],
  ])
    assert.throws(() => decodeFileDocument(Buffer.from(bytes), encoding), TypeError);
  assert.throws(
    () => decodeFileDocument(encodeFileText("\uFEFFa", "utf-16le"), "utf-8"),
    /conflicts/,
  );
  assert.throws(() => encodeFileText("\ud800", "gb18030"), /well-formed/);
  assert.throws(() => encodeFileText("a", "auto"), /resolved/);
});
