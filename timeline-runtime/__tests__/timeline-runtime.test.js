/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createSerializedWindowIndex, createWeakArrayIndex } from "../src/index.js";

test("array indexes track insertions without adding serialized state", () => {
  const values = [{ id: "a", sequence: 1 }];
  const arrayIndex = createWeakArrayIndex({ keyOf: (item) => item.id });
  const index = arrayIndex.indexFor(values);
  values.push({ id: "c", sequence: 3 });
  arrayIndex.recordInsertion(values, 1);
  values.splice(1, 0, { id: "b", sequence: 2 });
  arrayIndex.recordInsertion(values, 1);

  assert.deepEqual(
    values.map((item) => item.id),
    ["a", "b", "c"],
  );
  assert.equal(index.get("c"), 2);
  assert.equal(JSON.stringify(values).includes("index"), false);
});

test("array indexes keep independent arrays and falsy values addressable", () => {
  const values = [0];
  const arrayIndex = createWeakArrayIndex({ keyOf: String });
  const index = arrayIndex.indexFor(values);
  values.unshift(-1);
  arrayIndex.recordInsertion(values, 0);
  assert.equal(index.get("0"), 1);
  assert.equal(index.get("-1"), 0);
  assert.equal(arrayIndex.indexFor(values), index);
  assert.deepEqual([...arrayIndex.indexFor([0])], [["0", 0]]);
});

test("serialized window index keeps the wire array bounded", () => {
  const owner = { eventIds: ["a"] };
  const index = createSerializedWindowIndex({ field: "eventIds", limit: 2 });
  assert.equal(index.has(owner, "a"), true);
  assert.equal(index.append(owner, "b"), true);
  assert.equal(index.append(owner, "c"), true);
  assert.equal(index.append(owner, "c"), false);
  assert.deepEqual(owner.eventIds, ["b", "c"]);
});

test("serialized window index rejects a limit that is not a positive integer", () => {
  for (const limit of [0, -1, 1.5, "2", undefined]) {
    assert.throws(() => createSerializedWindowIndex({ field: "eventIds", limit }), TypeError);
  }
});
