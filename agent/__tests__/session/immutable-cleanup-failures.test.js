/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, readFile, readdir, rm, lstat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  immutablePublicationTemporaryFile,
} from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { buildImmutableCleanupPlan } from "../../src/session/session-artifact-session/immutable-cleanup-plan.js";
import {
  cleanupSessionArtifacts,
  discardSessionArtifactCleanup,
} from "../../src/session/session-artifact-maintenance.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";

function leaves(error) {
  return error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
}

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "cleanup-failures-"));
  t.after(async () => {
    resetFsAdapter();
    await rm(sessionDir, { recursive: true, force: true });
  });
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "cleanup-failures",
    allowCreate: true,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "messages", key: "m", value: "retained" }],
  });
  for (let i = 0; i < 2; i += 1) {
    const batch = store.objects.segments.createBatch();
    try {
      const record = batch.stage(Buffer.from(JSON.stringify(`orphan-${i}`)));
      await batch.publish([record]);
    } finally {
      batch.release();
    }
  }
  return {
    store,
    sessionDir,
    options: { storageService, sessionDir, assertSessionWritable: async () => {} },
  };
}

for (const rollback of ["remove", "sync", "both"]) {
  test(`preparation preserves allocation and rollback ${rollback} failures and leaves no executable manifest`, async (t) => {
    const { sessionDir, store, options } = await fixture(t);
    const publication = new Error("plan publication rejected");
    const removal = new Error("plan rollback removal failed");
    const synchronization = new Error("plan rollback sync failed");
    const parent = path.join(sessionDir, PLAN.directory);
    let failed = false;
    let syncs = 0;
    setFsAdapter({
      rm: async (file, ...args) => {
        if (failed && path.dirname(file) === parent && rollback !== "sync") throw removal;
        return rm(file, ...args);
      },
      open: async (file, flags, ...args) => {
        if (path.basename(file) === "capacity.json" && flags === "wx") {
          failed = true;
          throw publication;
        }
        if (failed && file === parent && flags === "r") {
          syncs += 1;
          if (rollback !== "remove") throw synchronization;
        }
        return open(file, flags, ...args);
      },
    });
    const expected = [publication];
    if (rollback !== "sync") expected.push(removal);
    if (rollback !== "remove") expected.push(synchronization);
    await assert.rejects(
      buildImmutableCleanupPlan({
        sessionDir,
        dryRun: false,
        publish: async () => assert.fail("allocation failure must precede publication"),
      }),
      (error) => {
        assert.deepEqual(leaves(error), expected);
        return true;
      },
    );
    assert.equal(syncs, 1);
    resetFsAdapter();
    for (const planId of await readdir(parent)) {
      await assert.rejects(readFile(path.join(parent, planId, PLAN.manifest)), { code: "ENOENT" });
      await discardSessionArtifactCleanup({ ...options, planId });
    }
    assert.equal(await store.get(await store.snapshot(), "messages", "m"), "retained");
  });
}

for (const cancel of [false, true]) {
  test(`${cancel ? "cancellation" : "candidate failure"} and directory sync failure preserve both causes and retry the unchanged cursor`, async (t) => {
    const { sessionDir, store, options } = await fixture(t);
    const plan = await buildImmutableCleanupPlan({
      sessionDir,
      dryRun: false,
      publish: (run) => run(),
    });
    assert.ok(plan.candidates >= 2);
    const progressPath = path.join(sessionDir, PLAN.directory, plan.planId, PLAN.progress);
    const before = await readFile(progressPath);
    const original = new Error(cancel ? "maintenance cancelled" : "candidate lstat failed");
    const synchronization = new Error("candidate sync failed");
    const controller = new AbortController();
    let inspected = 0;
    let syncs = 0;
    setFsAdapter({
      lstat: async (file, ...args) => {
        if (path.dirname(file) === store.objects.segments.directory && ++inspected === 2) {
          if (cancel) controller.abort(original);
          throw original;
        }
        return lstat(file, ...args);
      },
      open: async (file, flags, ...args) => {
        if (file === store.objects.segments.directory && flags === "r") {
          syncs += 1;
          throw synchronization;
        }
        return open(file, flags, ...args);
      },
    });
    await assert.rejects(
      cleanupSessionArtifacts({ ...options, planId: plan.planId, signal: controller.signal }),
      (error) => {
        assert.deepEqual(leaves(error), [original, synchronization]);
        return true;
      },
    );
    assert.equal(syncs, 1);
    assert.deepEqual(await readFile(progressPath), before);
    resetFsAdapter();
    const result = await cleanupSessionArtifacts({ ...options, planId: plan.planId });
    assert.equal(result.complete, true);
    assert.equal(result.processed, plan.candidates);
    assert.equal(result.removed.length, plan.candidates - 1);
    assert.equal(await store.get(await store.snapshot(), "messages", "m"), "retained");
  });
}

test("cleanup attempts every changed directory and preserves all sync failures before retry", async (t) => {
  const { sessionDir, store, options } = await fixture(t);
  await writeFile(immutablePublicationTemporaryFile(store.headPath, randomUUID()), "unpublished");
  const plan = await buildImmutableCleanupPlan({
    sessionDir,
    dryRun: false,
    publish: (run) => run(),
  });
  const progressPath = path.join(sessionDir, PLAN.directory, plan.planId, PLAN.progress);
  const before = await readFile(progressPath);
  const failures = new Map([
    [store.objects.segments.directory, new Error("segment directory sync failed")],
    [sessionDir, new Error("session directory sync failed")],
  ]);
  const attempted = [];
  setFsAdapter({
    open: async (file, flags, ...args) => {
      if (flags === "r" && failures.has(file)) {
        attempted.push(file);
        throw failures.get(file);
      }
      return open(file, flags, ...args);
    },
  });
  await assert.rejects(cleanupSessionArtifacts({ ...options, planId: plan.planId }), (error) => {
    assert.deepEqual(leaves(error), [...failures.values()]);
    return true;
  });
  assert.deepEqual(attempted, [...failures.keys()]);
  assert.deepEqual(await readFile(progressPath), before);
  resetFsAdapter();
  const result = await cleanupSessionArtifacts({ ...options, planId: plan.planId });
  assert.equal(result.complete, true);
  assert.equal(result.processed, plan.candidates);
  assert.deepEqual(result.removed, []);
  assert.equal(await store.get(await store.snapshot(), "messages", "m"), "retained");
});

test("initial preparation directory sync failure rolls back scratch and preserves failure identity", async (t) => {
  const { sessionDir } = await fixture(t);
  const parent = path.join(sessionDir, PLAN.directory);
  const failure = new Error("preparation directory sync failed");
  let syncs = 0;
  let published = false;
  setFsAdapter({
    open: async (file, flags, ...args) => {
      if (file === parent && flags === "r" && ++syncs === 1) throw failure;
      return open(file, flags, ...args);
    },
  });
  await assert.rejects(
    buildImmutableCleanupPlan({
      sessionDir,
      dryRun: false,
      publish: async () => {
        published = true;
      },
    }),
    (error) => error === failure,
  );
  assert.equal(published, false);
  assert.equal(syncs, 2);
  assert.deepEqual(await readdir(parent), []);
});
