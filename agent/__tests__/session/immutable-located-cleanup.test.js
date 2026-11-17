/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, access, open, rename, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableLocatedRecordStore } from "../../src/session/session-artifact-session/immutable-located-record-store.js";
import {
  buildImmutableCleanupPlan,
  applyImmutableCleanupPlan,
  discardImmutableCleanupPlan,
} from "../../src/session/session-artifact-session/immutable-cleanup-plan.js";
import { acquireImmutableReaderRetention } from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "located-cleanup-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "cleanup",
    allowCreate: true,
    objectStore: ImmutableLocatedRecordStore,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: Array.from({ length: 80 }, (_, i) => ({
      collection: "metadata",
      key: `item:${i}`,
      value: { i },
    })),
  });
  const abandoned = store.objects.segments.createBatch();
  const reference = abandoned.stage(Buffer.from("never committed"));
  await abandoned.publish([reference]);
  const orphan = store.objects.segments.segmentPath(
    decodeImmutableRecordReference(reference).segmentId,
  );
  return { sessionDir, store, orphan };
}

async function prepare(sessionDir) {
  const options = {
    sessionDir,
    objectStore: ImmutableLocatedRecordStore,
    dryRun: false,
    publish: (operation) => operation(),
  };
  let plan = await buildImmutableCleanupPlan(options);
  while (!plan.complete)
    plan = await buildImmutableCleanupPlan({ ...options, planId: plan.planId });
  return plan;
}
const apply = (sessionDir, planId) =>
  applyImmutableCleanupPlan({ sessionDir, planId, maxCandidates: 1, maxRemovals: 1 });

test("located cleanup preserves locator pages, contents, old readers and committed append tail", async (t) => {
  const { sessionDir, store, orphan } = await fixture(t);
  const reader = await acquireImmutableReaderRetention(store, async () => {});
  try {
    await store.commit({
      expectedGeneration: 1,
      operationId: "next",
      changes: [{ collection: "metadata", key: "item:0", value: "new" }],
    });
    const current = await store.snapshot();
    const oldPhysical = await Array.fromAsync(store.objects.physicalReferences(reader.head));
    const currentPhysical = await Array.fromAsync(store.objects.physicalReferences(current));
    assert.ok(oldPhysical.includes(reader.head.locationRoot));
    assert.ok(currentPhysical.includes(current.locationRoot));
    const plan = await prepare(sessionDir);
    assert.equal(plan.candidates, 1);
    const result = await apply(sessionDir, plan.planId);
    assert.equal(result.complete, true);
    assert.deepEqual(result.removed, [orphan]);
    await assert.rejects(access(orphan), { code: "ENOENT" });
    for (const reference of [...oldPhysical, ...currentPhysical])
      await store.objects.segments.read(reference);
    assert.deepEqual(await store.get(reader.head, "metadata", "item:0"), { i: 0 });
    assert.equal(await store.get(current, "metadata", "item:0"), "new");
    assert.equal(
      (await auditImmutableSession({ sessionDir, objectStore: ImmutableLocatedRecordStore })).ok,
      true,
    );
    assert.equal((await apply(sessionDir, plan.planId)).processedCandidates, 0);
  } finally {
    await reader.release();
  }
});

test("located cleanup advances across a committed descendant without scanning the retained graph", async (t) => {
  const { sessionDir, store, orphan } = await fixture(t);
  const plan = await prepare(sessionDir);
  await store.commit({
    expectedGeneration: 1,
    operationId: "advance",
    changes: [{ collection: "metadata", key: "x", value: 1 }],
  });
  const result = await apply(sessionDir, plan.planId);
  assert.equal(result.complete, true);
  assert.equal(result.historyProofLookups, 1);
  await assert.rejects(access(orphan), { code: "ENOENT" });
  const reopened = await ImmutableSessionStore.open({ sessionDir });
  assert.equal(await reopened.get(await reopened.snapshot(), "metadata", "x"), 1);
  assert.equal((await auditImmutableSession({ sessionDir })).ok, true);
});

for (const published of [false, true]) {
  test(`child relocation retries after ${published ? "published" : "unpublished"} head failure and preserves pinned readers through cleanup`, async (t) => {
    const { sessionDir, store } = await fixture(t);
    const retained = await acquireImmutableReaderRetention(store, async () => {});
    try {
      const before = retained.head;
      const reference = await store.objects.withSnapshot(before, async () =>
        store.index.get(await store.index.get(before.root, "metadata"), "item:0"),
      );
      const oldLocation = await store.objects.locations.get(before.locationRoot, reference);
      const originalHeadBytes = await readFile(store.headPath);
      let prepared = 0;
      const relocate = (owner) =>
        owner.transact({
          expectedGeneration: before.generation,
          operationId: "relocate-child",
          input: { reference },
          prepare: async () => {
            prepared += 1;
            await owner.objects.relocate({ identity: reference, sourceLocation: oldLocation });
            return { changes: [], result: { relocated: reference } };
          },
        });
      const failure = new Error("head acknowledgement lost");
      setFsAdapter({
        rename: async (source, target) => {
          if (target !== store.headPath) return rename(source, target);
          if (published) await rename(source, target);
          throw failure;
        },
      });
      try {
        await assert.rejects(relocate(store), {
          code: "SESSION_COMMIT_UNCERTAIN",
          cause: failure,
        });
      } finally {
        resetFsAdapter();
      }
      if (!published) assert.deepEqual(await readFile(store.headPath), originalHeadBytes);
      const restarted = await ImmutableSessionStore.open({ sessionDir });
      const result = await relocate(restarted);
      assert.equal(result.replayed, published);
      assert.equal(result.generation, before.generation + 1);
      assert.equal(prepared, published ? 1 : 2);
      const current = await restarted.snapshot();
      const newLocation = await restarted.objects.locations.get(current.locationRoot, reference);
      assert.notEqual(newLocation, oldLocation);
      const committedBytes = await readFile(restarted.headPath);
      assert.equal((await relocate(restarted)).replayed, true);
      assert.deepEqual(await readFile(restarted.headPath), committedBytes);
      const plan = await prepare(sessionDir);
      while (!(await apply(sessionDir, plan.planId)).complete) {
        continue;
      }
      for (const snapshot of [before, current])
        assert.deepEqual(await restarted.get(snapshot, "metadata", "item:0"), { i: 0 });
      assert.equal((await auditImmutableSession({ sessionDir })).ok, true);
    } finally {
      await retained.release();
    }
  });
}

test("damaged locator prevents publishing a deletion plan", async (t) => {
  const { sessionDir, store, orphan } = await fixture(t);
  const head = await store.snapshot();
  const record = decodeImmutableRecordReference(head.locationRoot);
  const handle = await open(store.objects.segments.segmentPath(record.segmentId), "r+");
  try {
    await handle.write(Buffer.from([0]), 0, 1, record.offset);
    await handle.sync();
  } finally {
    await handle.close();
  }
  let planId;
  await assert.rejects(prepare(sessionDir), (error) => {
    assert.equal(error.code, "SESSION_MAINTENANCE_PREPARATION_INTERRUPTED");
    assert.equal(error.cause.code, "SESSION_IMMUTABLE_STORAGE_INVALID");
    planId = error.planId;
    return true;
  });
  assert.equal((await discardImmutableCleanupPlan({ sessionDir, planId })).discarded, true);
  await access(orphan);
});
