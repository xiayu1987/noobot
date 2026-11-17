/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { IMMUTABLE_CLEANUP_PLAN as PLAN } from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import {
  prepareSessionArtifactCleanup,
  cleanupSessionArtifacts,
  discardSessionArtifactCleanup,
} from "../../src/session/session-artifact-maintenance.js";
import { resetFsAdapter, setFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { prepareSessionArtifactCleanupToCompletion } from "../helpers/immutable-cleanup.js";

async function within(operation) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("operation waited for the paused preparation")),
          3000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "cleanup-lock-boundaries-"));
  t.after(async () => {
    resetFsAdapter();
    await rm(sessionDir, { recursive: true, force: true });
  });
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "lock-boundaries",
    allowCreate: true,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: Array.from({ length: 160 }, (_, index) => ({
      collection: "metadata",
      key: `key-${index}`,
      value: `value-${index}`,
    })),
  });
  const options = {
    storageService,
    sessionDir,
    dryRun: false,
    assertSessionWritable: async () => {},
  };
  const prepared = await prepareSessionArtifactCleanup({ ...options, maxMarkingPages: 1 });
  assert.equal(prepared.complete, false);
  const request = { ...options, planId: prepared.planId, maxMarkingPages: 1 };
  const checkpoint = path.join(
    sessionDir,
    PLAN.directory,
    prepared.planId,
    PLAN.retentionDirectory,
    PLAN.retentionState,
  );
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let paused = false;
  setFsAdapter({
    open: async (file, flags, ...args) => {
      if (file === checkpoint && flags === "r" && !paused) {
        paused = true;
        entered.resolve();
        await release.promise;
      }
      return open(file, flags, ...args);
    },
  });
  const resume = prepareSessionArtifactCleanup(request);
  const outcome = resume.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await within(
    Promise.race([
      entered.promise,
      outcome.then(() => {
        throw new Error("preparation did not reach the checkpoint read");
      }),
    ]),
  );
  return { store, sessionDir, options, prepared, request, checkpoint, release, outcome };
}

test("paused preparation resumption permits business commits and preserves its pinned snapshot", async (t) => {
  const state = await fixture(t);
  const { store, options, request, prepared, release, outcome } = state;
  try {
    const old = await store.snapshot();
    await within(
      store.commit({
        expectedGeneration: old.generation,
        operationId: "write-while-preparing",
        changes: [{ collection: "metadata", key: "concurrent", value: "committed" }],
      }),
    );
    assert.equal((await store.snapshot()).generation, old.generation + 1);
  } finally {
    release.resolve();
    await outcome;
    resetFsAdapter();
  }
  const result = await outcome;
  assert.equal(result.error, undefined);
  assert.equal(result.value.generation, prepared.generation);
  const completed = await prepareSessionArtifactCleanupToCompletion(request);
  assert.equal(completed.generation, prepared.generation);
  const { dryRun, ...mutation } = options;
  assert.equal(dryRun, false);
  assert.equal(
    (await cleanupSessionArtifacts({ ...mutation, planId: prepared.planId })).complete,
    true,
  );
  const reopened = await ImmutableSessionStore.open({ sessionDir: state.sessionDir });
  assert.equal(
    await reopened.get(await reopened.snapshot(), "metadata", "concurrent"),
    "committed",
  );
  await discardSessionArtifactCleanup({ ...mutation, planId: prepared.planId });
});

for (const operation of ["resume", "discard", "apply"]) {
  test(`same-plan ${operation} waits outside the session lock while preparation is paused`, async (t) => {
    const { store, options, prepared, request, checkpoint, release, outcome } = await fixture(t);
    let settled = false;
    let pending;
    try {
      const { dryRun, ...mutation } = options;
      assert.equal(dryRun, false);
      const run =
        operation === "resume"
          ? () => prepareSessionArtifactCleanup(request)
          : operation === "discard"
            ? () => discardSessionArtifactCleanup({ ...mutation, planId: prepared.planId })
            : () => cleanupSessionArtifacts({ ...mutation, planId: prepared.planId });
      pending = run()
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        )
        .finally(() => {
          settled = true;
        });
      await setImmediate();
      await within(
        store.commit({
          expectedGeneration: (await store.snapshot()).generation,
          operationId: `write-before-${operation}`,
          changes: [{ collection: "metadata", key: "unblocked", value: operation }],
        }),
      );
      assert.equal(settled, false, "same-plan work cannot pass an active preparation");
      await readFile(checkpoint);
    } finally {
      release.resolve();
      await outcome;
      if (pending) await pending;
      resetFsAdapter();
    }
    assert.equal((await outcome).error, undefined);
    const result = await pending;
    if (operation === "apply") {
      assert.equal(result.error?.code, "ENOENT", "an unpublished plan cannot be executed");
    } else {
      assert.equal(result.error, undefined);
      if (operation === "discard") await assert.rejects(readFile(checkpoint), { code: "ENOENT" });
    }
  });
}
