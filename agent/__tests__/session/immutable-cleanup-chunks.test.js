/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readdir, readFile, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  IMMUTABLE_CURRENT_SESSION_FORMAT,
  IMMUTABLE_READER_RETENTION,
  decodeImmutableCleanupBytes,
  encodeImmutableCleanupRecord,
} from "@noobot/session-protocol/immutable-storage";
import { IMMUTABLE_CLEANUP_CAPACITY as CAPACITY } from "@noobot/session-protocol/immutable-cleanup-capacity";
import { writeDurableReplacement } from "../../src/session/session-artifact-session/immutable-storage-io.js";
import { ImmutableCleanupChunkWriter } from "../../src/session/session-artifact-session/immutable-cleanup-chunks.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { prepareSessionArtifactCleanup } from "../../src/session/session-artifact-maintenance.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "cleanup-chunk-capacity-"));
  t.after(async () => {
    resetFsAdapter();
    await rm(directory, { recursive: true, force: true });
  });
  const writer = new ImmutableCleanupChunkWriter(directory, IMMUTABLE_CURRENT_SESSION_FORMAT);
  await writer.initialize();
  return { directory, writer };
}

async function capacity(directory) {
  return decodeImmutableCleanupBytes(await readFile(path.join(directory, CAPACITY.file)));
}

async function pageCount(directory) {
  return (await readdir(directory)).filter((file) => /^[a-f0-9]{64}\.json$/.test(file)).length;
}

function* files(count, start = 0) {
  for (let index = start; index < start + count; index++)
    yield `segments/${index.toString(16).padStart(32, "0")}.seg`;
}

test("inventory and candidate chains share the exact protocol page limit", async (t) => {
  const { directory, writer } = await fixture(t);
  const inventory = await writer.write(files((PLAN.chunkPages - 1) * PLAN.chunkEntries));
  assert.equal(inventory.candidates, (PLAN.chunkPages - 1) * PLAN.chunkEntries);
  const resumed = new ImmutableCleanupChunkWriter(directory, IMMUTABLE_CURRENT_SESSION_FORMAT);
  const candidates = await resumed.write(files(PLAN.chunkEntries, inventory.candidates));
  assert.equal(candidates.candidates, PLAN.chunkEntries);
  const chunk = decodeImmutableCleanupBytes(
    await readFile(path.join(directory, `${candidates.firstChunk}.json`)),
  );
  assert.equal(chunk.previous, null, "a second chain must not adopt the inventory chain");
  assert.equal(await pageCount(directory), PLAN.chunkPages);
  await assert.rejects(writer.write(files(1)), { code: "SESSION_MAINTENANCE_CAPACITY_EXCEEDED" });
  assert.equal(
    await pageCount(directory),
    PLAN.chunkPages,
    "reject before allocating another page",
  );
});

test("uncertain page publication does not release the shared allocation", async (t) => {
  const { directory, writer } = await fixture(t);
  const failure = new Error("page directory sync failed");
  setFsAdapter({
    open: async (file, flags, ...args) => {
      const handle = await open(file, flags, ...args);
      if (String(file) === directory)
        handle.sync = async () => {
          throw failure;
        };
      return handle;
    },
  });
  await assert.rejects(writer.write(files(1)), (error) => error === failure);
  assert.equal((await capacity(directory)).pages, 1);
  resetFsAdapter();
  const resumed = new ImmutableCleanupChunkWriter(directory, IMMUTABLE_CURRENT_SESSION_FORMAT);
  await resumed.write(files(1));
  assert.equal((await capacity(directory)).pages, 1, "retry reuses the uncertain reservation");
  await resumed.write(files(1, 1));
  assert.equal((await capacity(directory)).pages, 2);
  assert.equal(await pageCount(directory), 2);
});

test("empty or cancelled input allocates no cleanup pages", async (t) => {
  const { directory, writer } = await fixture(t);
  assert.deepEqual(await writer.write(files(0)), { firstChunk: null, candidates: 0 });
  const failure = new Error("cancel cleanup preparation");
  await assert.rejects(
    writer.write(files(1), AbortSignal.abort(failure)),
    (error) => error === failure,
  );
  assert.equal(await pageCount(directory), 0);
  assert.equal((await capacity(directory)).pages, 0);
});

test("candidate capacity exhaustion preserves the plan and its captured roots for explicit recovery", async (t) => {
  const { directory: sessionDir } = await fixture(t);
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "capacity", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "metadata", key: "session", value: { sessionId: "capacity" } }],
  });
  const batch = store.objects.segments.createBatch();
  const reference = batch.stage(Buffer.from("orphan"));
  await batch.publish([reference]);
  const before = await readFile(path.join(sessionDir, "head.json"));
  const write = ImmutableCleanupChunkWriter.prototype.write;
  let inventoryWriter;
  let calls = 0;
  t.mock.method(ImmutableCleanupChunkWriter.prototype, "write", async function (...args) {
    if (++calls === 1) inventoryWriter = this;
    else {
      assert.equal(this.directory, inventoryWriter.directory);
      const state = await capacity(this.directory);
      assert.equal(state.pages, 1, "filtering must inherit captured page usage");
      await writeDurableReplacement(
        this.capacityFile,
        encodeImmutableCleanupRecord({
          ...state,
          pages: PLAN.chunkPages,
        }),
      );
    }
    return write.apply(this, args);
  });
  let planId;
  await assert.rejects(
    prepareSessionArtifactCleanup({
      storageService,
      sessionDir,
      dryRun: false,
      assertSessionWritable: async () => {},
    }),
    (error) => {
      assert.equal(error.code, "SESSION_MAINTENANCE_PREPARATION_INTERRUPTED");
      assert.equal(error.cause.code, "SESSION_MAINTENANCE_CAPACITY_EXCEEDED");
      planId = error.planId;
      return true;
    },
  );
  assert.equal(calls, 2);
  assert.deepEqual(await readdir(path.join(sessionDir, PLAN.directory)), [planId]);
  await readFile(path.join(sessionDir, PLAN.directory, planId, PLAN.preparation));
  await assert.rejects(readdir(path.join(sessionDir, IMMUTABLE_READER_RETENTION.directory)), {
    code: "ENOENT",
  });
  assert.deepEqual(await readFile(path.join(sessionDir, "head.json")), before);
  assert.equal(
    (await readdir(store.objects.segments.directory)).length,
    2,
    "preparation must never delete committed or orphan data",
  );
});
