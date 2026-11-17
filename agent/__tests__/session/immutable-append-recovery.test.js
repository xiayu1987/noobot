/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readdir, readFile, writeFile, open, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableRecordStore } from "../../src/session/session-artifact-session/immutable-record-store.js";
import { migrateImmutableSessionSegments } from "../../src/session/session-artifact-session/immutable-segment-migration.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { observeSessionStorageWork } from "../../src/session/session-artifact-session/storage-transaction.js";
import {
  IMMUTABLE_SEALED_SEGMENT_SESSION_FORMAT,
  encodeImmutableSessionHead,
} from "@noobot/session-protocol/immutable-storage";

async function fixture(t, objectStore) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-append-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  return new ImmutableSessionStore({
    sessionDir,
    sessionId: "append",
    allowCreate: true,
    objectStore,
  });
}
function request(generation, value) {
  return {
    expectedGeneration: generation,
    operationId: `append-${generation}`,
    changes: [{ collection: "messages", key: "m", value }],
  };
}
function wrapHandle(handle, overrides) {
  return new Proxy(handle, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

test("cold writers reuse one committed segment across small transactions and preserve old snapshots", async (t) => {
  let store = await fixture(t);
  const sessionDir = store.sessionDir;
  const snapshots = [];
  for (let generation = 0; generation < 40; generation += 1) {
    await store.commit(request(generation, { step: generation }));
    snapshots.push(await store.snapshot());
    store = await ImmutableSessionStore.open({ sessionDir });
  }
  const files = await readdir(store.objects.segments.directory);
  assert.equal(files.length, 1, "file count must not follow transaction count");
  for (const generation of [0, 19, 39])
    assert.deepEqual(await store.get(snapshots[generation], "messages", "m"), { step: generation });
  assert.equal(
    (await stat(store.objects.segments.segmentPath(snapshots.at(-1).segmentTail.segmentId))).size,
    snapshots.at(-1).segmentTail.end,
  );
  const report = await auditImmutableSession({ sessionDir });
  assert.equal(report.ok, true, JSON.stringify(report.issues));
});

test("append sync failure leaves head unchanged and a cold retry replaces only the uncommitted tail", async (t) => {
  const store = await fixture(t);
  await store.commit(request(0, { value: "committed" }));
  const before = await store.snapshot();
  const bytes = await readFile(store.headPath);
  const segment = store.objects.segments.segmentPath(before.segmentTail.segmentId);
  let injected = 0;
  setFsAdapter({
    open: async (file, flags) => {
      const handle = await open(file, flags);
      if (file !== segment || flags !== "r+") return handle;
      return wrapHandle(handle, {
        sync: async () => {
          injected += 1;
          throw new Error("append-sync-failed");
        },
      });
    },
  });
  try {
    await assert.rejects(store.commit(request(1, { value: "uncommitted" })), /append-sync-failed/);
  } finally {
    resetFsAdapter();
  }
  assert.equal(injected, 1);
  assert.deepEqual(await readFile(store.headPath), bytes);
  assert.ok((await stat(segment)).size > before.segmentTail.end);
  const cold = await ImmutableSessionStore.open({ sessionDir: store.sessionDir });
  assert.deepEqual(await cold.get(before, "messages", "m"), { value: "committed" });
  await cold.commit(request(1, { value: "retry" }));
  assert.deepEqual(await cold.get(await cold.snapshot(), "messages", "m"), { value: "retry" });
  assert.deepEqual(await cold.get(before, "messages", "m"), { value: "committed" });
  assert.equal((await readdir(cold.objects.segments.directory)).length, 1);
  assert.equal((await stat(segment)).size, (await cold.snapshot()).segmentTail.end);
});

test("a truncated committed append prefix fails explicitly without publishing a new head", async (t) => {
  const store = await fixture(t);
  await store.commit(request(0, { value: "committed" }));
  const before = await store.snapshot();
  const bytes = await readFile(store.headPath);
  const segment = store.objects.segments.segmentPath(before.segmentTail.segmentId);
  const handle = await open(segment, "r+");
  await handle.truncate(before.segmentTail.end - 1);
  await handle.close();
  await assert.rejects(store.commit(request(1, { value: "next" })), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  assert.deepEqual(await readFile(store.headPath), bytes);
});

test("ordinary append synchronizes the existing segment without segment directory operations", async (t) => {
  const store = await fixture(t);
  await store.commit(request(0, { value: 0 }));
  const directory = store.objects.segments.directory;
  const openedDirectories = [];
  setFsAdapter({
    open: async (file, flags) => {
      if (file === directory) openedDirectories.push(file);
      return open(file, flags);
    },
  });
  let work;
  try {
    ({ work } = await observeSessionStorageWork(() => store.commit(request(1, { value: 1 }))));
  } finally {
    resetFsAdapter();
  }
  assert.equal(work.immutableSegmentSyncs, 1);
  assert.deepEqual(openedDirectories, []);
});

test("sealed format requires explicit migration and leaves its old records untouched", async (t) => {
  const store = await fixture(t, ImmutableRecordStore);
  await store.commit(request(0, { value: "sealed" }));
  const { segmentTail: _tail, ...head } = await store.snapshot();
  const sealed = { ...head, format: IMMUTABLE_SEALED_SEGMENT_SESSION_FORMAT };
  const files = await readdir(store.objects.segments.directory);
  const segment = path.join(store.objects.segments.directory, files[0]);
  const original = await readFile(segment);
  await writeFile(store.headPath, encodeImmutableSessionHead(sealed, sealed.format));
  await assert.rejects(ImmutableSessionStore.open({ sessionDir: store.sessionDir }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await migrateImmutableSessionSegments({ sessionDir: store.sessionDir });
  const migrated = await ImmutableSessionStore.open({ sessionDir: store.sessionDir });
  const migratedTail = (await migrated.snapshot()).segmentTail;
  assert.notEqual(migratedTail, null);
  assert.notEqual(migratedTail.segmentId, _tail.segmentId);
  assert.deepEqual(await migrated.get(await migrated.snapshot(), "messages", "m"), {
    value: "sealed",
  });
  assert.equal((await migrated.commit(request(0, { value: "sealed" }))).replayed, true);
  const migratedFiles = await readdir(migrated.objects.segments.directory);
  await migrated.commit(request(1, { value: "append" }));
  assert.deepEqual(await readFile(segment), original);
  assert.equal((await readdir(migrated.objects.segments.directory)).length, migratedFiles.length);
  assert.equal((await migrated.snapshot()).segmentTail.segmentId, migratedTail.segmentId);
});
