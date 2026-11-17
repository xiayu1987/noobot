/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { IMMUTABLE_TRANSACTION_READ_CACHE } from "@noobot/session-protocol/immutable-storage-graph";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "concurrent-scope-read-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "s", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "initial",
    changes: [{ collection: "messages", key: "a", value: { text: "original" } }],
  });
  return { store, snapshot: await store.snapshot() };
}

test("concurrent index lookups share verified reads within the existing scope budget", async (t) => {
  const { store, snapshot } = await fixture(t);
  let reads = 0;
  const original = store.objects.segments.read.bind(store.objects.segments);
  store.objects.segments.read = async (...args) => {
    reads += 1;
    return original(...args);
  };
  const sequential = await store.get(snapshot, "messages", "a");
  const baseline = reads;
  reads = 0;
  await store.objects.withSnapshot(snapshot, async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.get(snapshot, "messages", "a")),
    );
    for (const result of results) assert.deepEqual(result, sequential);
    assert.equal(reads, baseline);
    const scope = store.objects.reads.getStore();
    assert.ok(scope.bytes <= IMMUTABLE_TRANSACTION_READ_CACHE.bytes);
    assert.ok(scope.records.size <= IMMUTABLE_TRANSACTION_READ_CACHE.records);
  });
  await store.get(snapshot, "messages", "a");
  assert.equal(reads, baseline * 2);
});

test("concurrent read failure reaches every waiter and does not poison a retry", async (t) => {
  const { store, snapshot } = await fixture(t);
  const original = store.objects.segments.read.bind(store.objects.segments);
  const failure = new Error("injected segment read failure");
  let reads = 0;
  store.objects.segments.read = async () => {
    reads += 1;
    throw failure;
  };
  await store.objects.withSnapshot(snapshot, async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => store.get(snapshot, "messages", "a")),
    );
    assert.equal(reads, 1);
    for (const result of results) {
      assert.equal(result.status, "rejected");
      assert.equal(result.reason, failure);
    }
    store.objects.segments.read = original;
    assert.deepEqual(await store.get(snapshot, "messages", "a"), { text: "original" });
  });
});
