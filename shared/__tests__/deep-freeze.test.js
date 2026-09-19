/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { deepFreeze } from "../deep-freeze.js";

test("deep freeze returns the same reference and freezes nested objects", () => {
  const source = { outer: { inner: { value: 1 } }, list: [{ item: 2 }] };
  const frozen = deepFreeze(source);
  assert.equal(frozen, source);
  assert.ok(Object.isFrozen(frozen));
  assert.ok(Object.isFrozen(frozen.outer));
  assert.ok(Object.isFrozen(frozen.outer.inner));
  assert.ok(Object.isFrozen(frozen.list));
  assert.ok(Object.isFrozen(frozen.list[0]));
});

test("deep freeze passes primitives and null through untouched", () => {
  for (const value of [null, undefined, 1, "text", true, Symbol("s")]) {
    assert.equal(deepFreeze(value), value);
  }
});

test("deep freeze terminates on cyclic references", () => {
  const node = { name: "node" };
  node.self = node;
  const child = { parent: node };
  node.child = child;
  const frozen = deepFreeze(node);
  assert.ok(Object.isFrozen(frozen));
  assert.ok(Object.isFrozen(frozen.child));
  assert.equal(frozen.self, frozen);
});

test("deep freeze rejects writes to nested values", () => {
  const frozen = deepFreeze({ outer: { inner: 1 } });
  assert.throws(() => {
    "use strict";
    frozen.outer.inner = 2;
  }, TypeError);
});
