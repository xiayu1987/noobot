/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPartitionCollectionReadBudget } from "../src/partition-collection-query.js";

const snapshot = { limits: { pageBytes: 10, pageRecords: 3 } };

test("a record that cannot fit the first window fails before reading its body", async () => {
  const budget = createPartitionCollectionReadBudget(snapshot);
  const io = [];
  const read = (bytes) => {
    budget.consume(bytes);
    io.push(bytes);
  };
  await assert.rejects(
    budget.readWindow(2, () => {
      read(2);
      read(9);
    }),
    { code: "SESSION_QUERY_BUDGET" },
  );
  assert.deepEqual(io, [2]);
});

test("only the read boundary ends a window; corruption and other failures propagate", async () => {
  const budget = createPartitionCollectionReadBudget(snapshot);
  assert.deepEqual(
    await budget.readWindow(3, (index) => {
      budget.consume(2);
      budget.consume(3);
      return index;
    }),
    [0, 1],
  );
  await assert.rejects(budget.readWindow(4, assert.fail), { code: "SESSION_QUERY_BUDGET" });
  const failure = Object.assign(new Error("Independent failure"), { code: "SESSION_QUERY_BUDGET" });
  await assert.rejects(
    budget.readWindow(2, (index) => {
      if (index === 1) throw failure;
      return index;
    }),
    (error) => error === failure,
  );
});
