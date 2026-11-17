/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
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

for (const boundary of ["remove", "directory-sync"]) {
  test(`published preparation retries ${boundary} failure without resetting deletion progress`, async (t) => {
    const sessionDir = await mkdtemp(path.join(tmpdir(), "cleanup-release-recovery-"));
    t.after(async () => {
      resetFsAdapter();
      await rm(sessionDir, { recursive: true, force: true });
    });
    const store = new ImmutableSessionStore({
      sessionDir,
      sessionId: "release-recovery",
      allowCreate: true,
    });
    await store.commit({
      expectedGeneration: 0,
      operationId: "seed",
      changes: [{ collection: "metadata", key: "item", value: "preserved" }],
    });
    for (let i = 0; i < 3; i++)
      await writeFile(immutablePublicationTemporaryFile(store.headPath, randomUUID()), "orphan");
    const options = {
      storageService,
      sessionDir,
      assertSessionWritable: async () => {},
    };
    const failure = new Error(`preparation release ${boundary} failed`);
    let removed = false;
    let directory;
    setFsAdapter({
      rm: async (file, ...args) => {
        if (path.basename(file) === PLAN.preparation) {
          directory = path.dirname(file);
          if (boundary === "remove") throw failure;
          await rm(file, ...args);
          removed = true;
          return;
        }
        return rm(file, ...args);
      },
      open: async (file, flags, ...args) => {
        const handle = await open(file, flags, ...args);
        if (file === directory && flags === "r" && removed)
          handle.sync = async () => {
            throw failure;
          };
        return handle;
      },
    });
    let planId;
    await assert.rejects(prepareSessionArtifactCleanup({ ...options, dryRun: false }), (error) => {
      assert.equal(error.code, "SESSION_MAINTENANCE_PREPARATION_INTERRUPTED");
      assert.equal(error.cause, failure);
      planId = error.planId;
      return true;
    });
    resetFsAdapter();
    assert.equal(directory, path.join(sessionDir, PLAN.directory, planId));
    const manifest = await readFile(path.join(directory, PLAN.manifest));
    const progress = await readFile(path.join(directory, PLAN.progress));
    if (boundary === "remove") await readFile(path.join(directory, PLAN.preparation));
    else await assert.rejects(readFile(path.join(directory, PLAN.preparation)), { code: "ENOENT" });

    let releaseSyncs = 0;
    setFsAdapter({
      rename: async (source, target, ...args) => {
        assert.notEqual(target, path.join(directory, PLAN.manifest));
        assert.notEqual(target, path.join(directory, PLAN.progress));
        assert.notEqual(target, path.join(directory, PLAN.preparation));
        return rename(source, target, ...args);
      },
      open: async (file, flags, ...args) => {
        const handle = await open(file, flags, ...args);
        if (file === directory && flags === "r") {
          const sync = handle.sync.bind(handle);
          handle.sync = async () => {
            releaseSyncs++;
            return sync();
          };
        }
        return handle;
      },
    });
    const retry = () => prepareSessionArtifactCleanup({ ...options, planId, dryRun: false });
    assert.equal((await retry()).complete, true);
    assert.ok(releaseSyncs > 0, "retry must synchronize even an already absent ownership record");
    assert.deepEqual(await readFile(path.join(directory, PLAN.manifest)), manifest);
    assert.deepEqual(await readFile(path.join(directory, PLAN.progress)), progress);
    await assert.rejects(readFile(path.join(directory, PLAN.preparation)), { code: "ENOENT" });
    resetFsAdapter();

    const partial = await cleanupSessionArtifacts({ ...options, planId, maxCandidates: 1 });
    assert.equal(partial.processed, 1);
    assert.equal(partial.complete, false);
    const advanced = await readFile(path.join(directory, PLAN.progress));
    assert.equal((await retry()).complete, true);
    assert.deepEqual(await readFile(path.join(directory, PLAN.progress)), advanced);
    const completed = await cleanupSessionArtifacts({ ...options, planId });
    assert.equal(completed.processed, 3);
    assert.equal(completed.complete, true);
    assert.equal(await store.get(await store.snapshot(), "metadata", "item"), "preserved");
    await discardSessionArtifactCleanup({ ...options, planId });
  });
}
