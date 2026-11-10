/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  createSerializedWindowIndex,
  createWeakArrayIndex,
  selectLatestOrderedFacts,
  upsertOrderedFact,
} from "../src/index.js";

test("array indexes and ordered facts preserve one serializable array", () => {
  const values = [{ id: "a", sequence: 1 }];
  const arrayIndex = createWeakArrayIndex({ keyOf: (item) => item.id });
  const index = arrayIndex.indexFor(values);
  upsertOrderedFact({
    values,
    fact: { id: "c", sequence: 3 },
    key: "c",
    index,
    compare: (left, right) => left.sequence - right.sequence,
    recordInsertion: arrayIndex.recordInsertion,
  });
  upsertOrderedFact({
    values,
    fact: { id: "b", sequence: 2 },
    key: "b",
    index,
    compare: (left, right) => left.sequence - right.sequence,
    recordInsertion: arrayIndex.recordInsertion,
  });

  assert.deepEqual(
    values.map((item) => item.id),
    ["a", "b", "c"],
  );
  assert.equal(index.get("c"), 2);
  assert.equal(JSON.stringify(values).includes("index"), false);
});

test("ordered insertion rejects a missing index updater before mutating facts", () => {
  const existing = { id: "b", sequence: 2 };
  const values = [existing];
  const index = new Map([["b", 0]]);
  assert.throws(
    () =>
      upsertOrderedFact({
        values,
        index,
        key: "a",
        fact: { id: "a", sequence: 1 },
        compare: (left, right) => left.sequence - right.sequence,
      }),
    /ordered insertion requires recordInsertion/,
  );
  assert.deepEqual(values, [existing]);
  assert.deepEqual([...index], [["b", 0]]);
});

test("ordered facts compare falsy values and preserve equal-fact insertion order", () => {
  const values = [0];
  const arrayIndex = createWeakArrayIndex({ keyOf: String });
  const index = arrayIndex.indexFor(values);
  upsertOrderedFact({
    values,
    index,
    key: "-1",
    fact: -1,
    compare: (left, right) => left - right,
    recordInsertion: arrayIndex.recordInsertion,
  });
  assert.deepEqual(values, [-1, 0]);
  assert.equal(index.get("0"), 1);

  const first = { id: "a", sequence: 1 };
  const last = { id: "c", sequence: 3 };
  const facts = [first, last];
  const factsIndex = createWeakArrayIndex({ keyOf: (item) => item.id });
  const incoming = { id: "b", sequence: 1 };
  upsertOrderedFact({
    values: facts,
    index: factsIndex.indexFor(facts),
    key: incoming.id,
    fact: incoming,
    compare: (left, right) => left.sequence - right.sequence,
    recordInsertion: factsIndex.recordInsertion,
  });
  assert.deepEqual(facts, [first, incoming, last]);
  assert.equal(factsIndex.indexFor(facts).get("c"), 2);
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

test("latest fact selection projects only the bounded result", () => {
  let projected = 0;
  const selected = selectLatestOrderedFacts([{ sequence: 3 }, { sequence: 1 }, { sequence: 2 }], {
    limit: 2,
    compare: (left, right) => left.sequence - right.sequence,
    project: (fact) => {
      projected += 1;
      return fact.sequence;
    },
  });
  assert.deepEqual(selected, [2, 3]);
  assert.equal(projected, 2);
});

test("latest fact selection retains canonical order across out-of-order input", () => {
  const selected = selectLatestOrderedFacts(
    [8, 2, 9, 1, 7, 10, 6].map((sequence) => ({ sequence })),
    {
      limit: 3,
      compare: (left, right) => left.sequence - right.sequence,
      project: (fact) => fact.sequence,
    },
  );
  assert.deepEqual(selected, [8, 9, 10]);
});

test("latest fact selection preserves stable input order for equal facts", () => {
  const selected = selectLatestOrderedFacts(["first", "second", "third"], {
    limit: 2,
    compare: () => 0,
  });
  assert.deepEqual(selected, ["second", "third"]);
});
