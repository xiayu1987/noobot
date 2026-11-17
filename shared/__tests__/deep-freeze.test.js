/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { deepFreeze, deepFreezeArray, isDeepFrozen } from "../deep-freeze.js";

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

test("successfully frozen graphs register every verified subtree for reuse", () => {
  const source = { outer: { inner: 1 }, list: [{ item: 2 }] };
  assert.equal(isDeepFrozen(source), false);
  deepFreeze(source);
  assert.ok(isDeepFrozen(source));
  assert.ok(isDeepFrozen(source.outer));
  assert.ok(isDeepFrozen(source.list));
  assert.ok(isDeepFrozen(source.list[0]));
  assert.equal(deepFreeze(source.outer), source.outer);
  assert.ok(isDeepFrozen(source.outer));
  assert.equal(isDeepFrozen(Object.freeze({ nested: {} })), false);
  assert.equal(isDeepFrozen("text"), false);
});

test("failed cyclic freezes cannot publish incomplete immutable graphs", () => {
  const root = {};
  const child = { parent: root };
  const failure = new Error("access failed");
  Object.assign(root, { child });
  Object.defineProperty(root, "failure", {
    enumerable: true,
    get() {
      throw failure;
    },
  });
  assert.throws(
    () => deepFreeze(root),
    (error) => error === failure,
  );
  assert.equal(isDeepFrozen(root), false);
  assert.equal(isDeepFrozen(child), false);
});

test("accessor graphs remain readable but cannot advertise stable content", () => {
  let reads = 0;
  const child = {
    get content() {
      reads += 1;
      return "stable";
    },
  };
  deepFreeze({ child });
  assert.equal(reads, 1);
  assert.equal(isDeepFrozen(child), false);
  assert.equal(deepFreeze(child), child);
  deepFreeze({ sharedChild: child, other: { value: 1 } });
  assert.equal(reads, 3);
  assert.throws(() => {
    child.extra = "mutation";
  }, TypeError);
});

test("internal slots and custom serialization cannot advertise stable content", () => {
  const serializer = {
    toJSON() {
      return 1;
    },
  };
  for (const value of [new Date(0), new Map(), new Set(), serializer]) {
    const root = deepFreeze({ value });
    assert.ok(Object.isFrozen(root));
    assert.ok(Object.isFrozen(value));
    assert.equal(isDeepFrozen(root), false);
    assert.equal(isDeepFrozen(value), false);
  }
  let current = 1;
  const source = {};
  Object.defineProperty(source, "toJSON", { value: () => current });
  deepFreeze(source);
  assert.equal(isDeepFrozen(source), false);
  assert.equal(JSON.stringify(source), "1");
  current = 2;
  assert.equal(JSON.stringify(source), "2");
});

test("frozen array copies own their container and freeze every retained element", () => {
  const nested = { value: 1 };
  const source = [nested, undefined, 2];
  const result = deepFreezeArray(source);
  assert.notEqual(result, source);
  assert.deepEqual(result, source);
  assert.ok(isDeepFrozen(result));
  assert.ok(isDeepFrozen(nested));
  source.push(3);
  assert.equal(result.length, 3);
  assert.throws(() => result.push(4), TypeError);
  assert.throws(() => {
    nested.value = 2;
  }, TypeError);
});

test("frozen array copies do not certify unstable children or inherit source accessors", () => {
  let value = 1;
  const dynamic = {
    get content() {
      return value;
    },
  };
  const result = deepFreezeArray([dynamic, new Date(0), () => value]);
  assert.equal(isDeepFrozen(result), false);
  value = 2;
  assert.equal(result[0].content, 2);
  const source = [];
  Object.defineProperty(source, 0, {
    get() {
      return value;
    },
    enumerable: true,
  });
  Object.defineProperty(source, "toJSON", { value: () => "custom" });
  const copy = deepFreezeArray(source);
  value = 3;
  assert.ok(isDeepFrozen(copy));
  assert.equal(copy[0], 2);
  assert.equal(JSON.stringify(copy), "[2]");
});
