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

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "transaction-scope-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "scoped", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [
      {
        collection: "metadata",
        key: "session",
        value: { sessionId: "scoped", parentSessionId: "parent" },
      },
    ],
  });
  return store;
}

test("snapshot rejection precedes preparation and leaves the committed generation unchanged", async (t) => {
  const store = await fixture(t);
  const before = await store.snapshot();
  const failure = new Error("scope rejected");
  let prepared = false;
  await assert.rejects(
    store.transact({
      expectedGeneration: before.generation,
      operationId: "rejected",
      input: {},
      validateSnapshot: async ({ snapshot, get }) => {
        assert.equal(snapshot.generation, before.generation);
        assert.equal(Object.isFrozen(snapshot), true);
        assert.equal((await get("metadata", "session")).parentSessionId, "parent");
        throw failure;
      },
      prepare: async () => {
        prepared = true;
        return { changes: [] };
      },
    }),
    (error) => error === failure,
  );
  assert.equal(prepared, false);
  assert.deepEqual(await store.snapshot(), before);
});

test("idempotent replay revalidates scope without preparing or publishing another generation", async (t) => {
  const store = await fixture(t);
  let validations = 0;
  let preparations = 0;
  const request = {
    expectedGeneration: 1,
    operationId: "scoped-change",
    input: {},
    validateSnapshot: async ({ get }) => {
      validations += 1;
      assert.equal((await get("metadata", "session")).parentSessionId, "parent");
    },
    prepare: async () => {
      preparations += 1;
      return { changes: [], result: "done" };
    },
  };
  const first = await store.transact(request);
  const replay = await store.transact(request);
  assert.equal(replay.replayed, true);
  assert.equal(replay.generation, first.generation);
  assert.equal(validations, 2);
  assert.equal(preparations, 1);
  const failure = new Error("new caller has wrong parent");
  await assert.rejects(
    store.transact({
      ...request,
      validateSnapshot: () => {
        throw failure;
      },
    }),
    (error) => error === failure,
  );
  assert.equal((await store.snapshot()).generation, first.generation);
});
