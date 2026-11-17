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
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { IMMUTABLE_INDEX_TARGET_BYTES } from "@noobot/session-protocol/immutable-storage-graph";
import { ImmutableObjectStore } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { ImmutableRadixIndex } from "../../src/session/session-artifact-session/immutable-radix-index.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";

const { keyBytes, blockBytes } = LENGTH_THRESHOLDS.immutableStorage;
const escapedKeyCount = Math.ceil(blockBytes / (6 * (keyBytes - 1))) + 1;

async function fixture(context) {
  const directory = await mkdtemp(path.join(tmpdir(), "immutable-radix-bytes-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function collect(index, root) {
  const entries = [];
  for await (const entry of index.entries(root)) entries.push(entry);
  return new Map(entries);
}

test("escaped legal keys split by encoded page bytes", async (context) => {
  const directory = await fixture(context);
  const objects = new ImmutableObjectStore(directory);
  const index = new ImmutableRadixIndex(objects);
  const value = await objects.putValue({ original: true });
  const keys = Array.from(
    { length: escapedKeyCount },
    (_, ordinal) => "\u0000".repeat(keyBytes - 1) + String(ordinal),
  );
  const expected = new Map(keys.map((key) => [key, value]));
  assert.ok(keys.every((key) => Buffer.byteLength(key) <= keyBytes));
  assert.ok(
    Buffer.byteLength(JSON.stringify({ kind: "index-leaf", entries: [...expected] })) > blockBytes,
  );
  await objects.withDurabilityBatch(async () => {
    let root = null;
    let previous = null;
    for (const key of keys) {
      previous = root;
      root = await index.set(root, key, value);
    }
    assert.equal((await objects.readPage(root)).kind, "index-branch");
    await objects.publishReachable([root, previous]);
    const cold = new ImmutableRadixIndex(new ImmutableObjectStore(directory));
    assert.deepEqual(await collect(cold, root), expected);
    for (const key of keys) assert.equal(await cold.get(root, key), value);
    assert.deepEqual(await collect(cold, previous), new Map([...expected].slice(0, -1)));
    const replacement = await objects.putValue({ updated: true });
    const updated = await index.set(root, keys[0], replacement);
    const deleted = await index.set(updated, keys[1], null);
    expected.set(keys[0], replacement);
    expected.delete(keys[1]);
    await objects.publishReachable([deleted]);
    assert.deepEqual(await collect(cold, deleted), expected);
    assert.equal(await cold.get(root, keys[0]), value);
    assert.equal(await cold.get(root, keys[1]), value);
  });
});

test("session commits and idempotent replay accept keys whose combined JSON exceeds one block", async (context) => {
  const sessionDir = await fixture(context);
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "byte-boundary",
    allowCreate: true,
  });
  const changes = Array.from({ length: escapedKeyCount }, (_, ordinal) => ({
    collection: "messages",
    key: "\u0001".repeat(keyBytes - 1) + String(ordinal),
    value: { ordinal },
  }));
  const request = { expectedGeneration: 0, operationId: "escaped-keys", changes };
  const result = await store.commit(request);
  const reopened = await ImmutableSessionStore.open({ sessionDir });
  const snapshot = await reopened.snapshot();
  for (const change of changes)
    assert.deepEqual(await reopened.get(snapshot, change.collection, change.key), change.value);
  assert.deepEqual(await reopened.commit(request), { ...result, replayed: true });
});

test("short keys share a byte-bounded leaf rather than splitting after eight entries", async (context) => {
  const directory = await fixture(context);
  const objects = new ImmutableObjectStore(directory);
  const index = new ImmutableRadixIndex(objects);
  await objects.withDurabilityBatch(async () => {
    const value = await objects.putValue("shared");
    const entries = Array.from({ length: 64 }, (_, ordinal) => [`short-${ordinal}`, value]);
    const root = await index.setMany(null, entries);
    const leaf = await objects.readPage(root);
    assert.equal(leaf.kind, "index-leaf");
    assert.equal(leaf.entries.length, entries.length);
    assert.ok(Buffer.byteLength(JSON.stringify(leaf)) <= IMMUTABLE_INDEX_TARGET_BYTES);
    await objects.publishReachable([root]);
    const cold = new ImmutableRadixIndex(new ImmutableObjectStore(directory));
    assert.deepEqual(await collect(cold, root), new Map(entries));
  });
});
