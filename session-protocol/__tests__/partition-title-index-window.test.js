/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  partitionTitleCandidatePageKey,
  updatePartitionTitleCandidates,
  verifyPartitionTitleCandidateWindow,
} from "../src/partition-title-index.js";

async function createDirectory(ordinals) {
  const pages = new Map([[partitionTitleCandidatePageKey(""), { ordinals: [] }]]);
  const reads = [];
  const plan = {
    async get(collection, key) {
      assert.equal(collection, "metadata");
      reads.push(key);
      return pages.get(key) ?? null;
    },
    async getMany(collection, keys) {
      return new Map(
        await Promise.all(keys.map(async (key) => [key, await this.get(collection, key)])),
      );
    },
    set(collection, key, value) {
      assert.equal(collection, "metadata");
      pages.set(key, value);
    },
    remove(collection, key) {
      assert.equal(collection, "metadata");
      pages.delete(key);
    },
  };
  await updatePartitionTitleCandidates(
    plan,
    ordinals.map((ordinal) => ({ ordinal, present: true })),
  );
  reads.length = 0;
  return { plan, reads };
}

test("title verification seeks each window through the protocol directory and checks its final boundary", async () => {
  const ordinals = Array.from({ length: 600 }, (_, index) => index + 1);
  const { plan, reads } = await createDirectory(ordinals);
  await verifyPartitionTitleCandidateWindow(plan, {
    after: 510,
    through: 515,
    count: 600,
    ordinals: [511, 512, 513, 514, 515],
  });
  assert.ok(
    !reads.includes(partitionTitleCandidatePageKey("000000000000")),
    "must skip the earlier leaf",
  );
  await verifyPartitionTitleCandidateWindow(plan, {
    after: 598,
    through: 600,
    count: 600,
    ordinals: [599, 600],
  });
});

for (const [name, stored, window] of [
  ["empty index", [], { after: 0, through: 2, count: 2, ordinals: [1, 2] }],
  ["missing first", [2], { after: 0, through: 2, count: 2, ordinals: [1, 2] }],
  ["missing last", [1], { after: 0, through: 2, count: 2, ordinals: [1, 2] }],
  ["extra within window", [1, 2], { after: 0, through: 2, count: 2, ordinals: [1] }],
  ["extra beyond history", [1, 2, 3], { after: 0, through: 2, count: 2, ordinals: [1, 2] }],
  ["candidate in empty history", [1], { after: 0, through: 0, count: 0, ordinals: [] }],
])
  test(`title verification rejects ${name}`, async () => {
    const { plan } = await createDirectory(stored);
    await assert.rejects(verifyPartitionTitleCandidateWindow(plan, window), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  });

test("title verification accepts empty history and sparse windows", async () => {
  const empty = await createDirectory([]);
  await verifyPartitionTitleCandidateWindow(empty.plan, {
    after: 0,
    through: 0,
    count: 0,
    ordinals: [],
  });
  const { plan } = await createDirectory([8]);
  await verifyPartitionTitleCandidateWindow(plan, { after: 0, through: 4, count: 8, ordinals: [] });
  await verifyPartitionTitleCandidateWindow(plan, {
    after: 4,
    through: 8,
    count: 8,
    ordinals: [8],
  });
});

test("invalid title verification windows fail before accessing storage", async () => {
  const plan = {
    get() {
      assert.fail("invalid window must not read storage");
    },
  };
  const valid = { after: 0, through: 2, count: 2, ordinals: [1, 2] };
  for (const invalid of [
    { after: -1 },
    { through: -1 },
    { count: 1 },
    { ordinals: null },
    { ordinals: [0] },
    { ordinals: [3] },
    { ordinals: [2, 1] },
    { ordinals: [1, 1] },
  ])
    await assert.rejects(
      verifyPartitionTitleCandidateWindow(plan, { ...valid, ...invalid }),
      TypeError,
    );
});
