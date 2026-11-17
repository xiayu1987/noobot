/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-batch-lookup-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "batch", allowCreate: true });
  const changes = Array.from({ length: 128 }, (_, index) => ({
    collection: "messages",
    key: `message-${index}`,
    value: { index },
  }));
  await store.commit({ expectedGeneration: 0, operationId: "seed", changes });
  return store;
}

test("batch lookup visits shared index paths once, preserves order, absence and pinned snapshots", async (t) => {
  const store = await fixture(t);
  const before = await store.snapshot();
  const keys = ["message-31", "missing", "message-0", "message-31", "message-127"];
  let visits = 0;
  const readPage = store.index.readPage.bind(store.index);
  store.index.readPage = (...args) => {
    visits += 1;
    return readPage(...args);
  };
  const expected = new Map();
  for (const key of keys) expected.set(key, await store.get(before, "messages", key));
  const singleVisits = visits;
  visits = 0;
  assert.deepEqual(await store.getMany(before, "messages", keys), expected);
  assert.ok(visits < singleVisits, `${visits} batch visits must be less than ${singleVisits}`);
  await store.commit({
    expectedGeneration: before.generation,
    operationId: "replace",
    changes: [
      { collection: "messages", key: "message-31", value: { index: "changed" } },
      { collection: "messages", key: "message-0", remove: true },
    ],
  });
  const reopened = new ImmutableSessionStore({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
  });
  assert.deepEqual(await reopened.getMany(before, "messages", keys), expected);
  const latest = await reopened.getMany(await reopened.snapshot(), "messages", keys);
  assert.deepEqual(latest.get("message-31"), { index: "changed" });
  assert.equal(latest.get("message-0"), null);
  assert.equal(latest.get("missing"), null);
  assert.deepEqual(await reopened.getMany(before, "messages", []), new Map());
  await assert.rejects(reopened.getMany(before, "messages", [""]), /Invalid/);
});
