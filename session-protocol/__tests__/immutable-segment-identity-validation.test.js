/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  requireImmutableContentDigest,
  requireImmutableSegmentId,
} from "../src/immutable-segment.js";

const invalid = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };

for (const [length, validate] of [
  [32, requireImmutableSegmentId],
  [64, requireImmutableContentDigest],
]) {
  test(`${length}-character storage identities accept only canonical lowercase hex`, () => {
    for (let position = 0; position < length; position++) {
      for (let code = 0; code < 128; code++) {
        const character = String.fromCharCode(code);
        const value = "a".repeat(position) + character + "0".repeat(length - position - 1);
        if ((code >= 48 && code <= 57) || (code >= 97 && code <= 102))
          assert.equal(validate(value), value);
        else assert.throws(() => validate(value), invalid);
      }
    }
    for (const character of ["é", "０", "ａ", "\ud800", "\udfff", "\u2028", "\u2029"]) {
      for (const position of [0, length / 2, length - 1]) {
        const value = "a".repeat(position) + character + "0".repeat(length - position - 1);
        assert.throws(() => validate(value), invalid);
      }
    }
    for (const value of [
      null,
      undefined,
      42,
      {},
      "",
      "a".repeat(length - 1),
      "a".repeat(length + 1),
    ])
      assert.throws(() => validate(value), invalid);
  });
}
