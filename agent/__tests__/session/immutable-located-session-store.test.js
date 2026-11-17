/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableLocatedRecordStore } from "../../src/session/session-artifact-session/immutable-located-record-store.js";
import { auditImmutableSnapshot } from "../../src/session/session-artifact-session/immutable-session-audit.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "located-session-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const options = {
    sessionDir,
    sessionId: "located-session",
    objectStore: ImmutableLocatedRecordStore,
  };
  const store = new ImmutableSessionStore({ ...options, allowCreate: true });
  return { store, options };
}

test("located sessions pin cold reads, stream entries and replay operations across generations", async (t) => {
  const { store, options } = await fixture(t);
  const operation = {
    expectedGeneration: 0,
    operationId: "first-operation",
    changes: [{ collection: "metadata", key: "test", value: { version: 1 } }],
  };
  const firstResult = await store.commit(operation);
  const first = await store.snapshot();
  await store.commit({
    expectedGeneration: 1,
    operationId: "second-operation",
    changes: [{ collection: "metadata", key: "test", value: { version: 2 } }],
  });
  const second = await store.snapshot();
  const cold = await ImmutableSessionStore.open(options);
  assert.deepEqual(await cold.get(first, "metadata", "test"), { version: 1 });
  assert.deepEqual(await cold.get(second, "metadata", "test"), { version: 2 });
  const replay = await cold.commit(operation);
  assert.equal(replay.replayed, true);
  assert.equal(replay.commit, firstResult.commit);
  assert.equal((await cold.snapshot()).generation, 2);
  const entries = [];
  for await (const entry of cold.entries(first, "metadata")) entries.push(entry);
  assert.deepEqual(new Map(entries).get("test"), { version: 1 });
  const changes = await cold.readCommitChanges(second, {
    generation: 1,
    collections: ["metadata"],
  });
  assert.deepEqual(changes.changes.find((change) => change.key === "test").value, { version: 1 });
  assert.equal((await readdir(path.join(options.sessionDir, "segments"))).length, 1);
  const audit = await auditImmutableSnapshot({
    store: cold,
    snapshot: second,
    retainedSnapshots: [first],
  });
  assert.equal(audit.ok, true, JSON.stringify(audit.issues));
});

test("located prepared transactions replay without preparing again and reject stale mutations", async (t) => {
  const { store, options } = await fixture(t);
  let preparations = 0;
  const transaction = {
    expectedGeneration: 0,
    operationId: "prepared-operation",
    input: { version: 1 },
    prepare: async ({ get, input }) => {
      preparations += 1;
      assert.equal(await get("metadata", "test"), null);
      return { changes: [{ collection: "metadata", key: "test", value: input }], result: input };
    },
  };
  assert.equal((await store.transact(transaction)).replayed, false);
  const cold = await ImmutableSessionStore.open(options);
  assert.equal((await cold.transact(transaction)).replayed, true);
  assert.equal(preparations, 1);
  await assert.rejects(
    cold.commit({ expectedGeneration: 0, operationId: "stale-operation", changes: [] }),
    { code: "SESSION_GENERATION_CONFLICT" },
  );
  assert.equal((await cold.snapshot()).generation, 1);
});
