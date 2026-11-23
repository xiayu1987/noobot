/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ImmutableObjectStore,
  contentDigest,
} from "../../src/session/session-artifact-session/immutable-object-store.js";
import { ImmutableRadixIndex } from "../../src/session/session-artifact-session/immutable-radix-index.js";
import { observeSessionStorageWork } from "../../src/session/session-storage-observation.js";

const INVALID = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "immutable-radix-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const objects = new ImmutableObjectStore(directory);
  return { objects, index: new ImmutableRadixIndex(objects) };
}

async function collect(index, root) {
  const entries = [];
  for await (const entry of index.entries(root)) entries.push(entry);
  return entries;
}

test("point, sparse and dense lookups preserve canonical string ordering and missing keys", async (t) => {
  const { objects, index } = await fixture(t);
  const keys = [
    ...Array.from({ length: 80 }, (_, i) => `key-${String(i).padStart(3, "0")}`),
    "A",
    "a",
    "é",
    "中",
    "\uE000",
    "😀",
  ];
  const expected = new Map();
  await objects.withDurabilityBatch(async () => {
    for (const key of keys) expected.set(key, await objects.putValue(key));
    const root = await index.setMany(null, [...expected]);
    await objects.publishReachable([root]);
    const cold = new ImmutableRadixIndex(new ImmutableObjectStore(path.dirname(objects.directory)));
    const missing = ["!", "key-001x", "key-999", "🫠"];
    for (const key of [...keys, ...missing])
      assert.equal(await cold.get(root, key), expected.get(key) ?? null);
    for (const selected of [
      [],
      [keys[0]],
      [keys.at(-1), missing[0]],
      [...keys, ...missing, keys[0]],
    ]) {
      assert.deepEqual(
        await cold.getMany(root, selected),
        new Map(selected.map((key) => [key, expected.get(key) ?? null])),
      );
    }
  });
});

test("batched changes publish each affected path once and preserve old roots", async (t) => {
  const { objects, index } = await fixture(t);
  await objects.withDurabilityBatch(async () => {
    const value = await objects.putValue("initial");
    const entries = Array.from({ length: 256 }, (_, i) => [`batch-${i}`, value]);
    const original = await index.setMany(null, entries);
    await objects.publishReachable([original]);
    const replacement = await objects.putValue("updated");
    const changes = entries.map(([key], i) => [key, i % 2 ? replacement : null]);
    const { result: updated, work } = await observeSessionStorageWork(async () => {
      const root = await index.setMany(original, changes);
      await objects.publishReachable([root]);
      return root;
    });
    assert.ok(work.immutableIndexPageReads < changes.length);
    assert.ok(work.immutableObjectWrites < changes.length);
    assert.deepEqual(new Map(await collect(index, original)), new Map(entries));
    assert.deepEqual(
      new Map(await collect(index, updated)),
      new Map(changes.filter(([, v]) => v !== null)),
    );
    assert.equal(await index.setMany(updated, changes), updated);
    assert.equal(
      await index.setMany(
        updated,
        changes.map(([key]) => [key, null]),
      ),
      null,
    );
    await assert.rejects(
      index.setMany(original, [
        ["duplicate", value],
        ["duplicate", null],
      ]),
      /Duplicate/,
    );
    const coldIndex = new ImmutableRadixIndex(
      new ImmutableObjectStore(path.dirname(objects.directory)),
    );
    assert.deepEqual(new Map(await collect(coldIndex, original)), new Map(entries));
    assert.deepEqual(
      new Map(await collect(coldIndex, updated)),
      new Map(changes.filter(([, v]) => v !== null)),
    );
  });
});

test("mixed leaf updates preserve exact canonical roots across unsorted batches and no-op deletions", async (t) => {
  const { objects, index } = await fixture(t);
  const keys = ["!", "A", "a", "é", "中", "\uE000", "😀", "🫠"];
  await objects.withDurabilityBatch(async () => {
    const first = await objects.putValue("first");
    const second = await objects.putValue("second");
    let root = null;
    const expected = new Map();
    for (let round = 0; round < 32; round += 1) {
      const changes = keys
        .map((key, index) => [key, [first, second, null, null][(round + index) % 4]])
        .reverse();
      const before = new Map(expected);
      const previous = root;
      for (const [key, value] of changes) {
        if (value === null) expected.delete(key);
        else expected.set(key, value);
      }
      root = await index.setMany(root, changes);
      assert.deepEqual(new Map(await collect(index, root)), expected);
      assert.deepEqual(new Map(await collect(index, previous)), before);
      assert.equal(await index.setMany(root, changes), root);
      const canonical = await index.setMany(null, [...expected].reverse());
      assert.equal(root, canonical);
    }
    await objects.publishReachable([root]);
  });
});

test("applyMany counts net membership changes once across branches and preserves snapshots", async (t) => {
  const { objects, index } = await fixture(t);
  await objects.withDurabilityBatch(async () => {
    const first = await objects.putValue("first");
    const second = await objects.putValue("second");
    const entries = Array.from({ length: 256 }, (_, i) => [`count-${i}`, first]);
    const original = await index.setMany(null, entries);
    const changes = [
      ...entries.map(([key], i) => [key, i % 3 === 0 ? null : i % 3 === 1 ? second : first]),
      ["new-count", second],
      ["missing-count", null],
    ];
    const { result, work } = await observeSessionStorageWork(() =>
      index.applyMany(original, changes),
    );
    assert.equal(result.added, 1);
    assert.equal(result.removed, 86);
    assert.equal(result.changed, 172);
    assert.ok(work.immutableIndexPageReads < entries.length);
    const expected = new Map(changes.filter(([, value]) => value !== null));
    assert.deepEqual(new Map(await collect(index, result.root)), expected);
    assert.deepEqual(new Map(await collect(index, original)), new Map(entries));
    const unchanged = await observeSessionStorageWork(() => index.applyMany(result.root, changes));
    assert.deepEqual(unchanged.result, { root: result.root, added: 0, removed: 0, changed: 0 });
    assert.equal(unchanged.work.immutableObjectWrites ?? 0, 0);
    assert.deepEqual(await index.applyMany(result.root, []), unchanged.result);
    const removed = await index.applyMany(
      result.root,
      [...expected.keys()].map((key) => [key, null]),
    );
    assert.deepEqual(removed, {
      root: null,
      added: 0,
      removed: expected.size,
      changed: expected.size,
    });
    await objects.publishReachable([original, result.root]);
    const cold = new ImmutableRadixIndex(new ImmutableObjectStore(path.dirname(objects.directory)));
    assert.deepEqual(new Map(await collect(cold, original)), new Map(entries));
    assert.deepEqual(new Map(await collect(cold, result.root)), expected);
  });
});

test("updateMany resolves each previous value once and shares the canonical update path", async (t) => {
  const { objects, index } = await fixture(t);
  await objects.withDurabilityBatch(async () => {
    const value = await objects.putValue("previous");
    const replacement = await objects.putValue("replacement");
    const entries = Array.from({ length: 256 }, (_, i) => [`resolve-${i}`, value]);
    const original = await index.setMany(null, entries);
    const changes = [
      ...entries.map(([key], i) => [key, i % 2 ? replacement : null]),
      ["added", replacement],
    ];
    const calls = new Map();
    const resolved = await observeSessionStorageWork(() =>
      index.updateMany(
        original,
        changes.map(([key]) => key),
        ({ key, previous, slot }) => {
          assert.equal(previous, key === "added" ? null : value);
          assert.ok(!calls.has(key));
          calls.set(key, previous);
          return changes[slot][1];
        },
      ),
    );
    const direct = await observeSessionStorageWork(() => index.applyMany(original, changes));
    assert.deepEqual(resolved.result, direct.result);
    assert.equal(resolved.work.immutableIndexPageReads, direct.work.immutableIndexPageReads);
    assert.equal(calls.size, changes.length);
    assert.deepEqual(new Map(await collect(index, original)), new Map(entries));
    await assert.rejects(
      index.updateMany(original, ["duplicate", "duplicate"], () => value),
      /Duplicate/,
    );
    await assert.rejects(index.updateMany(original, ["invalid"], () => "invalid"));
    await assert.rejects(index.updateMany(original, ["async"], async () => value));
    await assert.rejects(
      index.updateMany(original, ["failure"], () => {
        throw new Error("resolver failure");
      }),
      /resolver failure/,
    );
    await objects.publishReachable([original, resolved.result.root]);
  });
});

test("all index access paths reject a checksum-valid leaf under the wrong hash path", async (t) => {
  const { objects, index } = await fixture(t);
  const key = "misplaced";
  const digit = contentDigest(key)[0];
  const other = Array.from({ length: 100 }, (_, i) => `lookup-${i}`).find(
    (candidate) => contentDigest(candidate)[0] !== digit,
  );
  const value = await objects.putValue({ value: 1 });
  const leaf = await objects.putPage({ kind: "index-leaf", entries: [[key, value]] });
  const root = await objects.putPage({
    kind: "index-branch",
    depth: 0,
    children: { [contentDigest(other)[0]]: leaf },
  });
  await assert.rejects(index.get(root, other), INVALID);
  await assert.rejects(index.set(root, other, value), INVALID);
  await assert.rejects(index.set(root, other, null), INVALID);
  await assert.rejects(collect(index, root), INVALID);
});

test("index validation checks the full hash path, including same first-digit collisions", async (t) => {
  const { objects, index } = await fixture(t);
  const key = "deep-key";
  const digest = contentDigest(key);
  const other = Array.from({ length: 1000 }, (_, i) => `deep-${i}`).find((candidate) => {
    const hash = contentDigest(candidate);
    return hash[0] === digest[0] && hash[1] !== digest[1];
  });
  const otherDigest = contentDigest(other);
  const value = await objects.putValue(1);
  const leaf = await objects.putPage({ kind: "index-leaf", entries: [[key, value]] });
  const branch = await objects.putPage({
    kind: "index-branch",
    depth: 1,
    children: { [otherDigest[1]]: leaf },
  });
  const root = await objects.putPage({
    kind: "index-branch",
    depth: 0,
    children: { [digest[0]]: branch },
  });
  await assert.rejects(index.get(root, other), INVALID);
  await assert.rejects(index.set(root, other, value), INVALID);
  await assert.rejects(collect(index, root), INVALID);
});

test("malformed persisted leaf entries consistently report storage corruption", async (t) => {
  const { objects, index } = await fixture(t);
  const value = await objects.putValue(1);
  for (const entries of [
    [],
    [null],
    ["entry"],
    [["a"]],
    [["a", value, "extra"]],
    [[null, value]],
    [["", value]],
    [
      ["b", value],
      ["a", value],
    ],
    [
      ["a", value],
      ["a", value],
    ],
  ]) {
    const root = await objects.putPage({ kind: "index-leaf", entries });
    await assert.rejects(index.get(root, "a"), INVALID);
    await assert.rejects(index.set(root, "a", value), INVALID);
    await assert.rejects(collect(index, root), INVALID);
  }
});

test("malformed branches cannot masquerade as an absent key", async (t) => {
  const { objects, index } = await fixture(t);
  for (const children of ["abc", 1, [], null, {}, { z: "invalid" }]) {
    const root = await objects.putPage({ kind: "index-branch", depth: 0, children });
    await assert.rejects(index.get(root, "a"), INVALID);
    await assert.rejects(collect(index, root), INVALID);
  }
});

test("splits, updates and deletions preserve prior roots and exact enumeration", async (t) => {
  const { objects, index } = await fixture(t);
  const expected = new Map();
  let root = null;
  await objects.withDurabilityBatch(async () => {
    for (let i = 0; i < 160; i += 1) {
      const key = `key-${i}`;
      const value = await objects.putValue(i);
      expected.set(key, value);
      root = await index.set(root, key, value);
    }
    const original = root;
    const before = new Map(expected);
    for (let i = 1; i < 160; i += 2) {
      const key = `key-${i}`;
      const value = await objects.putValue({ updated: i });
      root = await index.set(root, key, value);
      expected.set(key, value);
    }
    const updated = root;
    const afterUpdates = new Map(expected);
    for (const [key, value] of expected) assert.equal(await index.get(updated, key), value);
    assert.equal(await index.set(root, "key-1", expected.get("key-1")), root);
    assert.equal(await index.set(root, "absent", null), root);
    for (let i = 0; i < 160; i += 2) {
      root = await index.set(root, `key-${i}`, null);
      expected.delete(`key-${i}`);
    }
    for (const [key, value] of expected) assert.equal(await index.get(root, key), value);
    assert.equal(await index.get(root, "absent"), null);
    assert.deepEqual(new Map(await collect(index, root)), expected);
    assert.deepEqual(new Map(await collect(index, original)), before);
    assert.deepEqual(new Map(await collect(index, updated)), afterUpdates);
    for (const key of expected.keys()) root = await index.set(root, key, null);
    assert.equal(root, null);
    assert.deepEqual(await collect(index, root), []);
    await objects.publishReachable([original, updated]);
    const coldIndex = new ImmutableRadixIndex(
      new ImmutableObjectStore(path.dirname(objects.directory)),
    );
    assert.deepEqual(new Map(await collect(coldIndex, original)), before);
    assert.deepEqual(new Map(await collect(coldIndex, updated)), afterUpdates);
  });
});

test("cold lookup and update visit only the selected radix path", async (t) => {
  const { objects, index } = await fixture(t);
  const expected = new Map();
  let root = null;
  await objects.withDurabilityBatch(async () => {
    for (let i = 0; i < 512; i += 1) {
      const key = `cold-${i}`;
      const value = await objects.putValue(i);
      expected.set(key, value);
      root = await index.set(root, key, value);
    }
    const key = "cold-257";
    const selectedPath = new Set();
    const digest = contentDigest(key);
    let reference = root;
    let depth = 0;
    while (reference !== null) {
      selectedPath.add(reference);
      const page = await objects.readPage(reference);
      if (page.kind === "index-leaf") break;
      reference = page.children[digest[depth++]] ?? null;
    }
    const changedValue = await objects.putValue("changed");
    await objects.publishReachable([root, changedValue]);
    const coldObjects = new ImmutableObjectStore(path.dirname(objects.directory));
    const visited = new Set();
    const observedObjects = Object.create(coldObjects);
    observedObjects.readPage = async (pageReference) => {
      assert.ok(selectedPath.has(pageReference), "unrelated index page must not be read");
      visited.add(pageReference);
      return coldObjects.readPage(pageReference);
    };
    observedObjects.putPage = (page) => objects.putPage(page);
    const coldIndex = new ImmutableRadixIndex(observedObjects);
    assert.equal(await coldIndex.get(root, key), expected.get(key));
    assert.deepEqual(visited, selectedPath);
    visited.clear();
    const { result: updated, work } = await observeSessionStorageWork(async () => {
      const result = await coldIndex.set(root, key, changedValue);
      await objects.publishReachable([result]);
      return result;
    });
    assert.deepEqual(visited, selectedPath);
    assert.equal(work.immutableIndexPageReads, selectedPath.size);
    assert.equal(work.immutableObjectWrites, selectedPath.size);
    assert.equal(await index.get(updated, key), changedValue);
    assert.deepEqual(new Map(await collect(index, root)), expected);
    expected.set(key, changedValue);
    assert.deepEqual(new Map(await collect(index, updated)), expected);
  });
});
