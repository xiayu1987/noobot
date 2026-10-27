/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  firstText,
  isFunction,
  isObjectLike,
  isPlainObject,
  requireFunctionDependencies,
  text,
} from "../value.js";

test("requireFunctionDependencies names every missing function dependency", () => {
  assert.doesNotThrow(() =>
    requireFunctionDependencies("owner", { a: () => {}, b: async () => {} }),
  );
  assert.throws(
    () => requireFunctionDependencies("owner", { a: () => {}, b: undefined, c: null, d: "x" }),
    { name: "TypeError", message: "owner requires function dependencies: b, c, d" },
  );
});

test("isFunction accepts functions and classes only", () => {
  for (const value of [() => {}, function named() {}, async () => {}, class Sample {}]) {
    assert.equal(isFunction(value), true);
  }
  for (const value of [null, undefined, {}, [], "function", 0]) {
    assert.equal(isFunction(value), false);
  }
});

test("isObjectLike accepts every non-null object including arrays", () => {
  for (const value of [{}, [], new Date(0), Object.create(null)]) {
    assert.equal(isObjectLike(value), true);
  }
  for (const value of [null, undefined, () => {}, "", 0, false]) {
    assert.equal(isObjectLike(value), false);
  }
});

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

test("text maps only nullish and blank values to an empty string", () => {
  for (const value of [undefined, null, "", "   "]) {
    assert.equal(text(value), "");
  }
  assert.equal(text(0), "0");
  assert.equal(text(false), "false");
});

test("firstText returns the first non-blank trimmed value", () => {
  assert.equal(firstText(undefined, null, "", "   ", "  a  ", "b"), "a");
  assert.equal(firstText(0, "b"), "0");
  assert.equal(firstText(false, "b"), "false");
  assert.equal(firstText(), "");
  assert.equal(firstText(undefined, "  "), "");
});
