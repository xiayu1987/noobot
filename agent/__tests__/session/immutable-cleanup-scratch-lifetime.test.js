/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  decodeImmutableCleanupBytes,
  immutablePublicationTemporaryFile,
} from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import {
  prepareSessionArtifactCleanup,
  cleanupSessionArtifacts,
  discardSessionArtifactCleanup,
} from "../../src/session/session-artifact-maintenance.js";
import { resetFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { prepareSessionArtifactCleanupToCompletion } from "../helpers/immutable-cleanup.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "cleanup-scratch-lifetime-"));
  t.after(async () => {
    resetFsAdapter();
    await rm(sessionDir, { recursive: true, force: true });
  });
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "scratch", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "messages", key: "message", value: "retained" }],
  });
  for (let index = 0; index <= PLAN.chunkEntries; index += 1)
    await writeFile(immutablePublicationTemporaryFile(store.headPath, randomUUID()), "unpublished");
  const context = { storageService, sessionDir, assertSessionWritable: async () => {} };
  const plan = await prepareSessionArtifactCleanupToCompletion({ ...context, dryRun: false });
  assert.equal(plan.candidates, PLAN.chunkEntries + 1);
  const request = { ...context, planId: plan.planId };
  const directory = path.join(sessionDir, PLAN.directory, plan.planId);
  return { store, directory, request };
}

async function scratchPages(directory) {
  return (await readdir(directory)).filter((file) => /^[a-f0-9]{64}\.json$/.test(file)).sort();
}

test("inventory and candidate pages share the plan lifetime across partial execution, completion and retry", async (t) => {
  const { store, directory, request } = await fixture(t);
  const pages = await scratchPages(directory);
  assert.equal(pages.length, 4);
  const first = await cleanupSessionArtifacts({ ...request, maxCandidates: 1 });
  assert.equal(first.processed, 1);
  assert.equal(first.complete, false);
  assert.deepEqual(await scratchPages(directory), pages);
  const rest = await cleanupSessionArtifacts(request);
  assert.equal(rest.complete, true);
  assert.equal(rest.processed, PLAN.chunkEntries + 1);
  const retry = await cleanupSessionArtifacts(request);
  assert.equal(retry.complete, true);
  assert.equal(retry.processedCandidates, 0);
  assert.deepEqual(await scratchPages(directory), pages);
  assert.equal(await store.get(await store.snapshot(), "messages", "message"), "retained");
  await discardSessionArtifactCleanup(request);
  await assert.rejects(readdir(directory), { code: "ENOENT" });
});

test("cursor publication is the final plan-directory durability boundary of a deletion batch", async (t) => {
  const { directory, request } = await fixture(t);
  const failure = new Error("unexpected post-cursor page retirement");
  let syncs = 0;
  setFsAdapter({
    open: async (file, flags, ...args) => {
      const handle = await open(file, flags, ...args);
      if (file === directory && flags === "r") {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          if (++syncs > 1) throw failure;
          return sync();
        };
      }
      return handle;
    },
  });
  const result = await cleanupSessionArtifacts(request);
  assert.equal(result.complete, true);
  assert.equal(syncs, 1);
  resetFsAdapter();
  await discardSessionArtifactCleanup(request);
});

test("a failed cursor directory sync leaves all scratch owned until retry and explicit disposal", async (t) => {
  const { directory, request } = await fixture(t);
  const pages = await scratchPages(directory);
  const failure = new Error("cursor sync failed");
  let syncs = 0;
  setFsAdapter({
    open: async (file, flags, ...args) => {
      const handle = await open(file, flags, ...args);
      if (file === directory && flags === "r") {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          if (++syncs === 1) throw failure;
          return sync();
        };
      }
      return handle;
    },
  });
  await assert.rejects(cleanupSessionArtifacts(request), (error) => error === failure);
  assert.deepEqual(await scratchPages(directory), pages);
  const retry = await cleanupSessionArtifacts(request);
  assert.equal(retry.complete, true);
  const progress = decodeImmutableCleanupBytes(await readFile(path.join(directory, PLAN.progress)));
  assert.equal(progress.processed, PLAN.chunkEntries + 1);
  assert.deepEqual(await scratchPages(directory), pages);
  resetFsAdapter();
  await discardSessionArtifactCleanup(request);
  await assert.rejects(readdir(directory), { code: "ENOENT" });
});

for (const boundary of ["remove", "sync"]) {
  test(`post-publication retention release ${boundary} failure preserves the plan for recovery`, async (t) => {
    const { directory, request } = await fixture(t);
    const parent = path.dirname(directory);
    const before = await readdir(parent);
    const failure = new Error("post-publication retention release failed");
    let published = false;
    let retentionReleased = false;
    let rollbackRemovals = 0;
    setFsAdapter({
      rename: async (source, target, ...args) => {
        const result = await rename(source, target, ...args);
        if (path.basename(target) === PLAN.manifest) published = true;
        return result;
      },
      rm: async (file, ...args) => {
        if (published && path.basename(file) === PLAN.preparation) {
          retentionReleased = true;
          if (boundary === "remove") throw failure;
        }
        if (published && path.dirname(file) === parent) rollbackRemovals += 1;
        return rm(file, ...args);
      },
      open: async (file, flags, ...args) => {
        const handle = await open(file, flags, ...args);
        if (
          boundary === "sync" &&
          retentionReleased &&
          path.dirname(file) === parent &&
          flags === "r"
        )
          handle.sync = async () => {
            throw failure;
          };
        return handle;
      },
    });
    const { planId, ...context } = request;
    let interruptedPlanId;
    await assert.rejects(
      prepareSessionArtifactCleanup({
        ...context,
        dryRun: false,
        maxFilterEntries: PLAN.chunkEntries * 2,
      }),
      (error) => {
        assert.equal(error.code, "SESSION_MAINTENANCE_PREPARATION_INTERRUPTED");
        assert.equal(error.cause, failure);
        interruptedPlanId = error.planId;
        return true;
      },
    );
    assert.equal(published, true);
    assert.equal(rollbackRemovals, 0);
    resetFsAdapter();
    const manifest = await readFile(path.join(parent, interruptedPlanId, PLAN.manifest));
    const recovered = await prepareSessionArtifactCleanup({
      ...context,
      dryRun: false,
      planId: interruptedPlanId,
    });
    assert.equal(recovered.complete, true);
    assert.deepEqual(await readFile(path.join(parent, interruptedPlanId, PLAN.manifest)), manifest);
    for (const remaining of await readdir(parent))
      if (!before.includes(remaining))
        await discardSessionArtifactCleanup({ ...context, planId: remaining });
    assert.deepEqual(await readdir(parent), before);
    await discardSessionArtifactCleanup({ ...context, planId });
  });
}
