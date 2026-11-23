/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PARTITION_CONTEXT_ROOT,
  partitionContextCandidatePageKey,
  partitionContextDialogKey,
  updatePartitionContextMembership,
} from "../src/partition-context-index.js";
import { ORDINAL_DIRECTORY_FANOUT, ordinalDirectoryPath } from "../src/ordinal-directory.js";

function fixture() {
  const values = new Map();
  const address = (collection, key) => JSON.stringify([collection, key]);
  let originals;
  const plan = {
    getOriginal: async (collection, key) => originals.get(address(collection, key)) ?? null,
    get: async (collection, key) => values.get(address(collection, key)) ?? null,
    getMany: async (collection, keys) =>
      new Map(keys.map((key) => [key, values.get(address(collection, key)) ?? null])),
    set: (collection, key, value) => values.set(address(collection, key), value),
    remove: (collection, key) => values.delete(address(collection, key)),
  };
  plan.set(PARTITION_CONTEXT_ROOT.collection, PARTITION_CONTEXT_ROOT.key, { ordinals: [] });
  plan.set("dialogs", "d1", {
    dialogOrdinal: 7,
    messageCount: 300,
    contextCandidates: { count: 0, directory: { ordinals: [] } },
  });
  const update = async (ordinal, present, change = () => {}) => {
    originals = structuredClone(values);
    await change();
    return updatePartitionContextMembership(plan, [{ dialogProcessId: "d1", ordinal, present }]);
  };
  return { plan, update };
}

test("context creation uses the dialog position and retirement preserves it after dialog removal", async () => {
  const { plan, update } = fixture();
  await update(10, true);
  assert.deepEqual((await plan.get("dialogs", "d1")).contextCandidates, {
    count: 1,
    directory: { ordinals: [10] },
  });
  assert.equal(await plan.get("contextDialogRanges", partitionContextDialogKey(7)), "d1");
  await update(10, false, () => plan.remove("dialogs", "d1"));
  assert.equal(await plan.get("dialogs", "d1"), null);
  assert.equal(await plan.get("contextDialogRanges", partitionContextDialogKey(7)), null);
  assert.deepEqual(await plan.get(PARTITION_CONTEXT_ROOT.collection, PARTITION_CONTEXT_ROOT.key), {
    ordinals: [],
  });
});

test("only zero crossings batch the context dialog root and ordinal mapping", async () => {
  const { plan, update } = fixture();
  const reads = [];
  const { get, getMany } = plan;
  const { collection, key } = PARTITION_CONTEXT_ROOT;
  const mapping = partitionContextDialogKey(7);
  plan.get = (name, id) => {
    assert.notEqual(name, collection);
    return get(name, id);
  };
  plan.getMany = (name, keys) => {
    reads.push([name, keys]);
    return getMany(name, keys);
  };
  await update(10, true);
  await update(11, true);
  await update(10, false);
  await update(11, false);
  assert.deepEqual(reads, [
    [collection, [key, mapping]],
    [collection, [key, mapping]],
  ]);
});

test("context membership rejects occupied and mismatched dialog mappings", async () => {
  const { plan, update } = fixture();
  const { collection, key } = PARTITION_CONTEXT_ROOT;
  const mapping = partitionContextDialogKey(7);
  plan.set(collection, mapping, "other");
  await assert.rejects(update(10, true), { code: "SESSION_STORAGE_CORRUPT" });
  assert.deepEqual(await plan.get(collection, key), { ordinals: [] });
  const registered = fixture();
  await registered.update(10, true);
  registered.plan.set(collection, mapping, "other");
  await assert.rejects(registered.update(10, false), { code: "SESSION_STORAGE_CORRUPT" });
  assert.deepEqual(await registered.plan.get(collection, key), { ordinals: [7] });
});

test("context leaf split checks sibling addresses in one batch without querying its embedded root", async () => {
  const { plan, update } = fixture();
  const count = ORDINAL_DIRECTORY_FANOUT;
  const ordinals = Array.from({ length: count }, (_, index) => index + 1);
  plan.set("dialogs", "d1", {
    ...(await plan.get("dialogs", "d1")),
    contextCandidates: { count, directory: { ordinals } },
  });
  const reads = [];
  const { getMany } = plan;
  plan.getMany = (collection, keys) => {
    reads.push([collection, keys]);
    return getMany(collection, keys);
  };
  const next = 16 ** (ordinalDirectoryPath(1).length - 2);
  await update(next, true);
  assert.deepEqual(reads, [
    [
      "contextCandidateRanges",
      ["00", "01"].map((prefix) => partitionContextCandidatePageKey("d1", prefix)),
    ],
  ]);
  assert.deepEqual((await plan.get("dialogs", "d1")).contextCandidates, {
    count: count + 1,
    directory: { slots: [0, 1] },
  });
});

test("context creation rejects a missing authoritative dialog", async () => {
  const { plan, update } = fixture();
  plan.remove("dialogs", "d1");
  await assert.rejects(update(10, true), { code: "SESSION_STORAGE_CORRUPT" });
  assert.equal(await plan.get("dialogs", "d1"), null);
});

for (const present of [true, false]) {
  test(`context ${present ? "addition" : "partial retirement"} rejects surviving candidates without a dialog`, async () => {
    const { plan, update } = fixture();
    await update(10, true);
    await update(11, true);
    await assert.rejects(
      update(present ? 12 : 11, present, () => plan.remove("dialogs", "d1")),
      {
        code: "SESSION_STORAGE_CORRUPT",
      },
    );
  });
}

test("context membership rejects a dialog whose position disagrees with its registered index", async () => {
  const { plan, update } = fixture();
  await update(10, true);
  await assert.rejects(
    update(11, true, async () => {
      plan.set("dialogs", "d1", { ...(await plan.get("dialogs", "d1")), dialogOrdinal: 8 });
    }),
    { code: "SESSION_STORAGE_CORRUPT" },
  );
});
