/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { IMMUTABLE_CLEANUP_PLAN as PLAN } from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { buildImmutableCleanupPlan } from "../../src/session/session-artifact-session/immutable-cleanup-plan.js";
import { resetFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";

for (const boundary of ["before-rename", "after-rename"]) {
  test(`first capture failure ${boundary} rolls back without a recovery id`, async (t) => {
    const sessionDir = await mkdtemp(path.join(tmpdir(), "cleanup-capture-rollback-"));
    t.after(async () => {
      resetFsAdapter();
      await rm(sessionDir, { recursive: true, force: true });
    });
    const store = new ImmutableSessionStore({
      sessionDir,
      sessionId: "rollback",
      allowCreate: true,
    });
    await store.commit({
      expectedGeneration: 0,
      operationId: "seed",
      changes: [{ collection: "metadata", key: "item", value: "kept" }],
    });
    const before = await readFile(store.headPath);
    const failure = new Error("first capture publication failed");
    let failedDirectory;
    let syncFailed = false;
    let published = false;
    setFsAdapter({
      rename: async (source, target, ...args) => {
        if (path.basename(target) === PLAN.capture) {
          if (boundary === "before-rename") throw failure;
          await rename(source, target, ...args);
          failedDirectory = path.dirname(target);
          return;
        }
        return rename(source, target, ...args);
      },
      open: async (target, flags, ...args) => {
        const handle = await open(target, flags, ...args);
        if (target === failedDirectory && flags === "r" && !syncFailed) {
          handle.sync = async () => {
            syncFailed = true;
            throw failure;
          };
        }
        return handle;
      },
    });
    await assert.rejects(
      buildImmutableCleanupPlan({
        sessionDir,
        dryRun: false,
        publish: (run) => {
          published = true;
          return run();
        },
      }),
      (error) => {
        assert.equal(error, failure);
        assert.equal(error.planId, undefined);
        return true;
      },
    );
    resetFsAdapter();
    assert.equal(published, false);
    assert.deepEqual(await readdir(path.join(sessionDir, PLAN.directory)), []);
    assert.deepEqual(await readFile(store.headPath), before);
    assert.equal(await store.get(await store.snapshot(), "metadata", "item"), "kept");
    const retried = await buildImmutableCleanupPlan({
      sessionDir,
      dryRun: false,
      publish: (run) => run(),
    });
    assert.equal(retried.complete, true);
  });
}
