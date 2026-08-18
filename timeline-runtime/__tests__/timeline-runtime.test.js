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

  assert.deepEqual(values.map((item) => item.id), ["a", "b", "c"]);
  assert.equal(index.get("c"), 2);
  assert.equal(JSON.stringify(values).includes("index"), false);
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

test("latest fact selection projects only the bounded result", () => {
  let projected = 0;
  const selected = selectLatestOrderedFacts(
    [{ sequence: 3 }, { sequence: 1 }, { sequence: 2 }],
    {
      limit: 2,
      compare: (left, right) => left.sequence - right.sequence,
      project: (fact) => {
        projected += 1;
        return fact.sequence;
      },
    },
  );
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
