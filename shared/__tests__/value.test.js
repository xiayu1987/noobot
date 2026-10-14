/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { isPlainObject, text } from "../value.js";

test("isPlainObject accepts non-null non-array objects", () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject({ key: "value" }), true);
  assert.equal(isPlainObject(Object.create(null)), true);
  assert.equal(isPlainObject(new Date(0)), true);
});

test("isPlainObject rejects arrays, null and primitives", () => {
  for (const value of [null, undefined, [], 0, 1, "", "object", true, false, () => {}]) {
    assert.equal(isPlainObject(value), false);
  }
});

test("text trims strings and stringifies truthy values", () => {
  assert.equal(text("  value  "), "value");
  assert.equal(text(42), "42");
  assert.equal(text(true), "true");
});

test("text maps every falsy value to an empty string", () => {
  for (const value of [undefined, null, "", 0, false, Number.NaN]) {
    assert.equal(text(value), "");
  }
});
