/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { partitionEntityPageKeyBytes } from "../src/partition-entity-page-budget.js";

const wireBytes = (key) => Buffer.byteLength(JSON.stringify(JSON.stringify(key))) - 2;

test("entity key byte accounting matches native JSON for every UTF-16 code unit", () => {
  for (let code = 0; code <= 0xffff; code += 1) {
    const key = String.fromCharCode(code);
    assert.equal(partitionEntityPageKeyBytes(key), wireBytes(key), `code unit ${code}`);
  }
});

test("entity key accounting preserves surrogate pairing and mixed nested escaping", () => {
  const cases = [
    "",
    "普通标识",
    'a\"\\\n\r\t\b\f\u0000',
    "🙂",
    "\ud800\ud800\udc00\udc00",
    "\u2028\u2029",
  ];
  let state = 1729;
  for (let length = 0; length < 512; length += 1) {
    let key = "";
    for (let index = 0; index < length; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      key += String.fromCharCode(state & 0xffff);
    }
    cases.push(key);
  }
  for (const key of cases) assert.equal(partitionEntityPageKeyBytes(key), wireBytes(key));
  assert.throws(() => partitionEntityPageKeyBytes(null), TypeError);
});
