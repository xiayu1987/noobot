/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  immutablePublicationTemporaryFile,
  decodeImmutableCleanupBytes,
} from "@noobot/session-protocol/immutable-storage";
import { IMMUTABLE_CLEANUP_FILTER as FILTER } from "@noobot/session-protocol/immutable-cleanup-filter";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import {
  prepareSessionArtifactCleanup,
  cleanupSessionArtifacts,
} from "../../src/session/session-artifact-maintenance.js";
import { prepareSessionArtifactCleanupToCompletion } from "../helpers/immutable-cleanup.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "cleanup-filter-recovery-"));
  t.after(async () => {
    resetFsAdapter();
    await rm(sessionDir, { recursive: true, force: true });
  });
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "filter", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "metadata", key: "item", value: "preserved" }],
  });
  const files = [];
  for (let i = 0; i < PLAN.chunkEntries * 2 + 3; i += 1) {
    const file = immutablePublicationTemporaryFile(store.headPath, randomUUID());
    await writeFile(file, "unpublished");
    files.push(path.basename(file));
  }
  const options = {
    storageService,
    sessionDir,
    dryRun: false,
    maxFilterEntries: 1,
    assertSessionWritable: async () => {},
  };
  const initial = await prepareSessionArtifactCleanup(options);
  assert.equal(initial.phase, "filtering");
  assert.equal(initial.complete, false);
  assert.equal(initial.processedEntries, 1);
  const directory = path.join(sessionDir, PLAN.directory, initial.planId);
  return { store, sessionDir, directory, files, options: { ...options, planId: initial.planId } };
}

async function candidateFiles(directory) {
  const plan = decodeImmutableCleanupBytes(await readFile(path.join(directory, PLAN.manifest)));
  const files = [];
  let reference = plan.firstChunk;
  while (reference !== null) {
    const chunk = decodeImmutableCleanupBytes(
      await readFile(path.join(directory, `${reference}.json`)),
    );
    files.push(...chunk.files);
    reference = chunk.previous;
  }
  assert.equal(files.length, plan.candidates);
  return files.sort();
}

test("filtering resumes after process exit with pending candidates across inventory pages", async (t) => {
  const { store, sessionDir, directory, files, options } = await fixture(t);
  const maintenance = new URL("../../src/session/session-artifact-maintenance.js", import.meta.url)
    .href;
  const service = new URL("../helpers/storage-service.js", import.meta.url).href;
  await promisify(execFile)(
    process.execPath,
    [
      "--import",
      new URL("../../../shared/testing/runtime-params.js", import.meta.url).href,
      "--input-type=module",
      "-e",
      `import { prepareSessionArtifactCleanup } from ${JSON.stringify(maintenance)};
     import { TEST_STORAGE_SERVICE } from ${JSON.stringify(service)};
     for (let i = 0; i < 7; i++) {
       const result = await prepareSessionArtifactCleanup({ storageService: TEST_STORAGE_SERVICE,
         sessionDir: process.argv[1], planId: process.argv[2], dryRun: false,
         maxFilterEntries: 1, assertSessionWritable: async () => {} });
       if (result.complete || result.processedEntries !== 1) throw new Error('unexpected batch');
     }`,
      sessionDir,
      options.planId,
    ],
    { timeout: 15000 },
  );
  const state = decodeImmutableCleanupBytes(await readFile(path.join(directory, FILTER.file)));
  assert.equal(state.progress.processed, 8);
  assert.ok(state.output.pending.length > 0);
  const result = await prepareSessionArtifactCleanupToCompletion(options);
  assert.equal(result.candidates, files.length);
  assert.deepEqual(await candidateFiles(directory), files.sort());
  await assert.rejects(readFile(path.join(directory, PLAN.preparation)), { code: "ENOENT" });
  const { dryRun, maxFilterEntries, ...applyOptions } = options;
  assert.equal(dryRun, false);
  assert.equal(maxFilterEntries, 1);
  const applied = await cleanupSessionArtifacts(applyOptions);
  assert.equal(applied.complete, true);
  for (const file of files)
    await assert.rejects(readFile(path.join(sessionDir, file)), { code: "ENOENT" });
  assert.equal(await store.get(await store.snapshot(), "metadata", "item"), "preserved");
});

for (const published of [false, true]) {
  test(`filter checkpoint failure ${published ? "after" : "before"} replacement resumes the durable candidate prefix`, async (t) => {
    const { directory, files, options } = await fixture(t);
    const checkpoint = path.join(directory, FILTER.file);
    const before = await readFile(checkpoint);
    const failure = new Error("filter checkpoint publication failed");
    setFsAdapter({
      rename: async (source, target, ...args) => {
        if (target !== checkpoint) return rename(source, target, ...args);
        if (published) await rename(source, target, ...args);
        throw failure;
      },
    });
    await assert.rejects(prepareSessionArtifactCleanup(options), (error) => error === failure);
    resetFsAdapter();
    const after = await readFile(checkpoint);
    if (!published) assert.deepEqual(after, before);
    else assert.equal(decodeImmutableCleanupBytes(after).progress.processed, 2);
    await readFile(path.join(directory, PLAN.preparation));
    const result = await prepareSessionArtifactCleanupToCompletion(options);
    assert.equal(result.candidates, files.length);
    assert.deepEqual(await candidateFiles(directory), files.sort());
  });
}
