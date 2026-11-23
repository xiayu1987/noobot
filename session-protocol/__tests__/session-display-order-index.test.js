/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptySessionDisplayOrderPage,
  encodeSessionDisplayOrderKey,
  readSessionDisplayOrderWindow,
  readSessionDisplayPage,
  createSessionDisplayStats,
  updateSessionDisplayOrder,
} from "@noobot/session-protocol/session-reader";

function fixture() {
  const pages = new Map([["", emptySessionDisplayOrderPage()]]);
  const reads = [];
  const store = {
    get(prefix) {
      reads.push(prefix);
      return pages.get(prefix) ?? null;
    },
    set: (prefix, page) => pages.set(prefix, page),
    remove: (prefix) => pages.delete(prefix),
  };
  return { pages, reads, store };
}

const transition = (order, after = true) => ({ order, before: !after, after });

test("rank windows agree with canonical order after interleaved insertion and retirement", async () => {
  const { store, pages, reads } = fixture();
  const source = Array.from({ length: 4096 }, (_, i) => [0, i + 1, 0]);
  const tails = [
    [1, 3, 0],
    [1, Number.MAX_SAFE_INTEGER, 0],
  ];
  const anchors = [
    [0, 17, 1],
    [0, 64, 1],
    [0, 3000, 1],
  ];
  const all = [...tails, ...source.toReversed(), ...anchors];
  const removed = [source[16], source[63], tails[0]];
  let count = await updateSessionDisplayOrder(
    store,
    0,
    all.map((key) => transition(key)),
  );
  const retained = new Map(pages);
  count = await updateSessionDisplayOrder(
    store,
    count,
    removed.map((key) => transition(key, false)),
  );
  const oracle = all
    .filter((key) => !removed.includes(key))
    .sort(([a, b, c], [d, e, f]) => a - d || b - e || c - f)
    .map(encodeSessionDisplayOrderKey);
  for (const after of [0, 14, 60, 2048, count - 4]) {
    reads.length = 0;
    assert.deepEqual(
      await readSessionDisplayOrderWindow(store.get, { count, after, length: 4 }),
      oracle.slice(after, after + 4),
    );
    assert.ok(reads.length <= 32, `window visited ${reads.length} of ${pages.size} pages`);
  }
  assert.ok(pages.size > 32);
  const tailWindow = await readSessionDisplayOrderWindow((prefix) => retained.get(prefix), {
    count: all.length,
    after: all.length - tails.length,
    length: tails.length,
  });
  assert.deepEqual(tailWindow, tails.map(encodeSessionDisplayOrderKey));
});

test("the display page reads the same ranked window in both directions", async () => {
  const { store } = fixture();
  const count = await updateSessionDisplayOrder(
    store,
    0,
    Array.from({ length: 40 }, (_, i) => transition([0, i + 1, 0])),
  );
  const scope = {
    sessionId: "s",
    parentSessionId: "",
    snapshotId: "snapshot",
    generation: 1,
    aggregateVersion: 1,
  };
  const stats = createSessionDisplayStats({
    messageCount: count,
    displayMessageCount: count,
    injectedMessageCount: 0,
    thinkingMessageCount: 0,
    toolLogCount: 0,
    displayToolLogCount: 0,
    unassignedToolArtifactCount: 0,
    conflictedToolArtifactCount: 0,
    attachmentCount: 0,
  });
  for (const [direction, first] of [
    ["forward", 1],
    ["backward", 38],
  ]) {
    const page = await readSessionDisplayPage(
      scope,
      { direction, cursor: null, limit: 3, maxBytes: 4096 },
      {
        readStatistics: () => ({ ...scope, stats }),
        readWindow: async (_, { after, length }) => ({
          ...scope,
          after,
          messages: (async function* () {
            for (const key of await readSessionDisplayOrderWindow(store.get, {
              count,
              after,
              length,
            })) {
              const row = { key };
              yield { jsonBytes: Buffer.byteLength(JSON.stringify(row)), read: () => row };
            }
          })(),
        }),
      },
    );
    assert.deepEqual(
      page.messages,
      [first, first + 1, first + 2].map((ordinal) => ({
        key: encodeSessionDisplayOrderKey([0, ordinal, 0]),
      })),
    );
  }
});

test("consecutive ranks do not visit the shared zero padding of the row key", async () => {
  const { store, reads } = fixture();
  const count = await updateSessionDisplayOrder(
    store,
    0,
    Array.from({ length: 128 }, (_, index) => transition([0, index + 1, 0])),
  );
  reads.length = 0;
  assert.deepEqual(
    await readSessionDisplayOrderWindow(store.get, { count, after: 127, length: 1 }),
    [encodeSessionDisplayOrderKey([0, 128, 0])],
  );
  assert.ok(reads.length <= 4, `Read ${reads.length} pages for the last rank`);
});

test("ranking routes preserve order across digit lengths and presentation kinds", async () => {
  const { store } = fixture();
  const rows = Array.from({ length: 60 }, (_, index) => [0, 0xf0 + index, index % 2]);
  rows.push([0, 0xfff, 1], [0, 0x1000, 0], [0, Number.MAX_SAFE_INTEGER, 1]);
  rows.push([1, 1, 0], [1, 0x10, 0], [1, Number.MAX_SAFE_INTEGER, 0]);
  const count = await updateSessionDisplayOrder(
    store,
    0,
    rows.toReversed().map((order) => transition(order)),
  );
  assert.deepEqual(
    await readSessionDisplayOrderWindow(store.get, { count, after: 0, length: count }),
    rows.map(encodeSessionDisplayOrderKey),
  );
});

test("replacing a ranked row validates membership without rewriting ranking pages", async () => {
  const { store, pages } = fixture();
  const order = [0, 1, 0];
  const count = await updateSessionDisplayOrder(
    store,
    0,
    Array.from({ length: 40 }, (_, index) => transition([0, index + 1, 0])),
  );
  const original = new Map(pages);
  const readonly = {
    get: store.get,
    set: () => assert.fail("A payload-only edit cannot rewrite the directory"),
    remove: () => assert.fail("A payload-only edit cannot remove directory pages"),
  };
  const replace = (order) => ({ order, before: true, after: true });
  assert.equal(await updateSessionDisplayOrder(readonly, count, [replace(order)]), count);
  assert.deepEqual(pages, original);
  for (const missing of [
    [0, 0x1000, 0],
    [1, 1, 0],
    [0, 1, 1],
  ]) {
    await assert.rejects(updateSessionDisplayOrder(readonly, count, [replace(missing)]), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  }
});

test("a row batch reads and writes each affected ranking page at most once", async () => {
  const { store, reads, pages } = fixture();
  const initial = Array.from({ length: 128 }, (_, i) => [0, i + 1, 0]);
  const count = await updateSessionDisplayOrder(
    store,
    0,
    initial.map((key) => transition(key)),
  );
  const writes = [];
  const observed = {
    get: store.get,
    set(key, page) {
      writes.push(key);
      store.set(key, page);
    },
    remove(key) {
      writes.push(key);
      store.remove(key);
    },
  };
  reads.length = 0;
  const insert = Array.from({ length: 9 }, (_, i) => [0, i + 3, 1]);
  const retire = initial.slice(4, 9);
  const next = await updateSessionDisplayOrder(observed, count, [
    ...insert.map((key) => transition(key)),
    ...retire.map((key) => transition(key, false)),
  ]);
  assert.equal(next, 132);
  assert.equal(reads.length, new Set(reads).size);
  assert.equal(writes.length, new Set(writes).size);
  assert.equal(writes.filter((key) => key === "").length, 1);
  assert.deepEqual(
    await readSessionDisplayOrderWindow((key) => pages.get(key), {
      count: next,
      after: 0,
      length: next,
    }),
    [...initial.filter((key) => !retire.includes(key)), ...insert]
      .map(encodeSessionDisplayOrderKey)
      .sort(),
  );
});

test("missing pages, count drift and duplicate transitions fail closed", async () => {
  const { store, pages } = fixture();
  const order = [0, 1, 0];
  let count = await updateSessionDisplayOrder(store, 0, [transition(order)]);
  assert.throws(
    () => updateSessionDisplayOrder(store, count, [transition(order), transition(order, false)]),
    /Duplicate display order transition/,
  );
  await assert.rejects(updateSessionDisplayOrder(store, count, [transition(order)]), {
    code: "SESSION_STORAGE_CORRUPT",
  });
  await assert.rejects(
    readSessionDisplayOrderWindow(store.get, { count: 2, after: 0, length: 1 }),
    {
      code: "SESSION_STORAGE_CORRUPT",
    },
  );
  count = await updateSessionDisplayOrder(store, count, [transition(order, false)]);
  assert.equal(count, 0);
  assert.deepEqual(pages.get(""), emptySessionDisplayOrderPage());
  pages.set("", { children: [["0", 1]] });
  await assert.rejects(
    readSessionDisplayOrderWindow(store.get, { count: 1, after: 0, length: 1 }),
    {
      code: "SESSION_STORAGE_CORRUPT",
    },
  );
  pages.set("0", { keys: [encodeSessionDisplayOrderKey([1, 1, 0])] });
  await assert.rejects(
    readSessionDisplayOrderWindow(store.get, { count: 1, after: 0, length: 1 }),
    {
      code: "SESSION_STORAGE_CORRUPT",
    },
  );
});
