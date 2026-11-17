/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import {
  readImmutableListProjection,
  upgradeImmutableListProjection,
} from "../../src/session/session-artifact-session/immutable-list-projection.js";
import { resetFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-list-retirement-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "list", allowCreate: true });
  const projection = { version: 1, messageCount: 999, lastMessage: { content: "stale" } };
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed-previous-format",
    changes: [
      { collection: "metadata", key: "facts", value: { messageCount: 0, lastMessageUid: "" } },
      { collection: "metadata", key: "listProjection", value: projection },
    ],
  });
  return { store, projection, sessionDir };
}

test("retiring a duplicate list projection preserves facts and old snapshots and is idempotent", async (t) => {
  const { store, projection, sessionDir } = await fixture(t);
  const previous = await store.snapshot();
  const facts = await store.get(previous, "metadata", "facts");
  const upgrade = () => upgradeImmutableListProjection({ sessionDir, sessionId: store.sessionId });
  await upgrade();
  const current = await store.snapshot();
  assert.equal(current.generation, previous.generation + 1);
  assert.equal(await store.get(current, "metadata", "listProjection"), null);
  assert.deepEqual(await store.get(current, "metadata", "facts"), facts);
  assert.deepEqual(await store.get(previous, "metadata", "listProjection"), projection);
  assert.deepEqual(
    await readImmutableListProjection((collection, key) => store.get(current, collection, key)),
    { messageCount: 0, lastMessage: null },
  );
  const head = await readFile(store.headPath);
  assert.equal((await upgrade()).replayed, true);
  assert.deepEqual(await readFile(store.headPath), head);
});

test("failed retirement preserves the previous head and retries through the same migration", async (t) => {
  const { store, projection, sessionDir } = await fixture(t);
  const previous = await store.snapshot();
  const upgrade = () => upgradeImmutableListProjection({ sessionDir, sessionId: store.sessionId });
  setFsAdapter({
    rename: async (source, target) => {
      if (target === store.headPath)
        throw Object.assign(new Error("injected retirement head failure"), { code: "EIO" });
      return rename(source, target);
    },
  });
  try {
    await assert.rejects(upgrade(), { code: "SESSION_COMMIT_UNCERTAIN" });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), previous);
  assert.deepEqual(await store.get(previous, "metadata", "listProjection"), projection);
  await upgrade();
  const current = await store.snapshot();
  assert.equal(current.generation, previous.generation + 1);
  assert.equal(await store.get(current, "metadata", "listProjection"), null);
});

for (const facts of [
  { messageCount: -1, lastMessageUid: "" },
  { messageCount: 1, lastMessageUid: "missing" },
]) {
  test(`retirement rejects broken authoritative facts without publishing: ${JSON.stringify(facts)}`, async (t) => {
    const { store, projection, sessionDir } = await fixture(t);
    await store.commit({
      expectedGeneration: 1,
      operationId: "damage-facts",
      changes: [{ collection: "metadata", key: "facts", value: facts }],
    });
    const head = await readFile(store.headPath);
    await assert.rejects(
      upgradeImmutableListProjection({ sessionDir, sessionId: store.sessionId }),
      { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
    );
    assert.deepEqual(await readFile(store.headPath), head);
    assert.deepEqual(
      await store.get(await store.snapshot(), "metadata", "listProjection"),
      projection,
    );
  });
}
