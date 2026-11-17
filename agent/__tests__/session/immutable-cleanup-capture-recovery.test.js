/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, open, readFile, rename, readdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  decodeImmutableCleanupBytes,
} from "@noobot/session-protocol/immutable-storage";
import { IMMUTABLE_CLEANUP_FILTER as FILTER } from "@noobot/session-protocol/immutable-cleanup-filter";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { buildImmutableCleanupPlan } from "../../src/session/session-artifact-session/immutable-cleanup-plan.js";
import { resetFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "cleanup-capture-recovery-"));
  t.after(async () => {
    resetFsAdapter();
    await rm(sessionDir, { recursive: true, force: true });
  });
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "capture", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "metadata", key: "kept", value: "kept" }],
  });
  return { store, sessionDir, dryRun: false, publish: (run) => run() };
}

for (const file of [PLAN.preparation, FILTER.file, PLAN.retentionState, PLAN.capture]) {
  for (const boundary of ["before-rename", "after-rename"]) {
    test(`capture initialization recovers ${file} failure ${boundary} in a fresh process`, async (t) => {
      const options = await fixture(t);
      const failure = new Error("initialization publication failed");
      let captured = false;
      let failedDirectory;
      setFsAdapter({
        rename: async (source, target, ...args) => {
          const name = path.basename(target);
          if (captured && name === file) {
            if (boundary === "before-rename") throw failure;
            await rename(source, target, ...args);
            failedDirectory = path.dirname(target);
            return;
          }
          const result = await rename(source, target, ...args);
          if (name === PLAN.capture) captured = true;
          return result;
        },
        open: async (target, flags, ...args) => {
          const handle = await open(target, flags, ...args);
          if (target === failedDirectory && flags === "r")
            handle.sync = async () => {
              throw failure;
            };
          return handle;
        },
      });
      let planId;
      await assert.rejects(buildImmutableCleanupPlan(options), (error) => {
        assert.equal(error.code, "SESSION_MAINTENANCE_PREPARATION_INTERRUPTED");
        assert.equal(error.cause, failure);
        planId = error.planId;
        return true;
      });
      resetFsAdapter();
      const directory = path.join(options.sessionDir, PLAN.directory, planId);
      const capture = decodeImmutableCleanupBytes(
        await readFile(path.join(directory, PLAN.capture)),
      );
      const chunks = (await readdir(directory)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
      const ownershipFile = path.join(directory, PLAN.preparation);
      const ownership =
        file === PLAN.preparation && boundary === "before-rename"
          ? null
          : await readFile(ownershipFile);
      await options.store.commit({
        expectedGeneration: 1,
        operationId: "later",
        changes: [{ collection: "metadata", key: "later", value: "later" }],
      });
      const module = new URL(
        "../../src/session/session-artifact-session/immutable-cleanup-plan.js",
        import.meta.url,
      ).href;
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          "--import",
          new URL("../../../shared/testing/runtime-params.js", import.meta.url).href,
          "--input-type=module",
          "-e",
          `import { buildImmutableCleanupPlan } from ${JSON.stringify(module)};
         const options = JSON.parse(process.argv[1]); options.publish = run => run();
         let result; do { result = await buildImmutableCleanupPlan(options); } while (!result.complete);
         console.log(JSON.stringify(result));`,
          JSON.stringify({ sessionDir: options.sessionDir, dryRun: false, planId }),
        ],
        { timeout: 15000 },
      );
      const result = JSON.parse(stdout);
      assert.equal(result.complete, true);
      assert.equal(result.planId, planId);
      assert.equal(result.generation, ownership === null ? 2 : 1);
      const ready = decodeImmutableCleanupBytes(await readFile(path.join(directory, PLAN.capture)));
      assert.equal(ready.ready, true);
      assert.equal(ready.firstChunk, capture.firstChunk);
      for (const chunk of chunks) await readFile(path.join(directory, chunk));
      assert.equal(
        await options.store.get(await options.store.snapshot(), "metadata", "kept"),
        "kept",
      );
    });
  }
}

test("a ready capture cannot rebuild a missing ownership record", async (t) => {
  const options = await fixture(t);
  const failure = new Error("plan publication failed");
  let planId;
  await assert.rejects(
    buildImmutableCleanupPlan({
      ...options,
      publish: async () => {
        throw failure;
      },
    }),
    (error) => {
      planId = error.planId;
      assert.equal(error.cause, failure);
      return true;
    },
  );
  const directory = path.join(options.sessionDir, PLAN.directory, planId);
  await unlink(path.join(directory, PLAN.preparation));
  await assert.rejects(buildImmutableCleanupPlan({ ...options, planId }), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(directory, PLAN.preparation)), { code: "ENOENT" });
});
