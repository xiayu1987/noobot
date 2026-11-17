/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { access, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  immutablePublicationTemporaryFile,
  immutablePublicationTarget,
} from "@noobot/session-protocol/immutable-storage";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { immutableSegmentFileName } from "@noobot/session-protocol/immutable-segment";
import { committedPhysicalRecord } from "./helpers/immutable-record-reads.js";
import {
  cleanupSessionArtifacts,
  prepareSessionArtifactCleanup,
} from "../../src/session/session-artifact-maintenance.js";
import { prepareAndCleanupSessionArtifacts } from "../helpers/immutable-cleanup.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";

const token = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "publication-cleanup-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({ sessionDir, sessionId: "s1", allowCreate: true });
  await store.commit({
    expectedGeneration: 0,
    operationId: "initialize",
    changes: [{ collection: "messages", key: "m1", value: "retained" }],
  });
  const snapshot = await store.snapshot();
  const reference = await store.objects.withSnapshot(snapshot, async () => {
    const root = await store.index.get(snapshot.root, "messages");
    return store.index.get(root, "m1");
  });
  const options = { storageService, sessionDir, assertSessionWritable: async () => {} };
  assert.equal(
    (await prepareAndCleanupSessionArtifacts({ ...options, dryRun: false })).complete,
    true,
  );
  return { sessionDir, store, snapshot, reference, options };
}

test("publication naming round-trips paths and rejects foreign or malformed suffixes", () => {
  for (const target of ["head.json", "immutable-session.format", "a".repeat(62), "/tmp/a\nb"]) {
    assert.equal(
      immutablePublicationTarget(immutablePublicationTemporaryFile(target, token)),
      target,
    );
  }
  for (const file of [null, "head.json", `head.json.${token}.tmp.extra`, "x.not-a-uuid.tmp"])
    assert.equal(immutablePublicationTarget(file), null);
  for (const bad of ["", "not-a-uuid", token.toUpperCase()])
    assert.throws(() => immutablePublicationTemporaryFile("head.json", bad), TypeError);
});

test("cleanup reclaims crash leftovers beside retained objects without touching foreign entries or readers", async (t) => {
  const { store, snapshot, reference, options } = await fixture(t);
  const retained = store.objects.segments.segmentPath(
    (await committedPhysicalRecord(store, reference)).segmentId,
  );
  const original = await readFile(retained);
  const temporary = immutablePublicationTemporaryFile(retained, token);
  await writeFile(temporary, "incomplete replacement");
  const bucket = path.dirname(retained);
  const foreign = [
    path.join(bucket, `foreign.${token}.tmp`),
    `${retained}.not-a-uuid.tmp`,
    `${retained}.${token}.tmp.extra`,
  ];
  for (const file of foreign) await writeFile(file, "keep");
  const directory = immutablePublicationTemporaryFile(
    path.join(bucket, immutableSegmentFileName("b".repeat(32))),
    token,
  );
  await mkdir(directory);
  const link = immutablePublicationTemporaryFile(
    path.join(bucket, immutableSegmentFileName("c".repeat(32))),
    token,
  );
  await symlink(retained, link);
  const head = await readFile(store.headPath);
  const preview = await prepareAndCleanupSessionArtifacts({ ...options, dryRun: true });
  assert.deepEqual(preview.removed, [temporary]);
  await access(temporary);
  const cleaned = await prepareAndCleanupSessionArtifacts({ ...options, dryRun: false });
  assert.deepEqual(cleaned.removed, [temporary]);
  await assert.rejects(access(temporary), { code: "ENOENT" });
  for (const file of [...foreign, directory, link]) await access(file);
  assert.deepEqual(await readFile(retained), original);
  assert.deepEqual(await readFile(store.headPath), head);
  assert.equal(await store.get(snapshot, "messages", "m1"), "retained");
});

test("segment temporary cleanup shares the removal budget and subsequent batches finish", async (t) => {
  const { store, reference, options } = await fixture(t);
  const retained = store.objects.segments.segmentPath(
    (await committedPhysicalRecord(store, reference)).segmentId,
  );
  const temporary = immutablePublicationTemporaryFile(retained, token);
  const second = immutablePublicationTemporaryFile(
    retained,
    "11111111-2222-3333-4444-555555555555",
  );
  await writeFile(temporary, "partial one");
  await writeFile(second, "partial two");
  const { planId } = await prepareSessionArtifactCleanup({ ...options, dryRun: false });
  const removed = [];
  for (let batch = 0; batch < 2; batch += 1) {
    const result = await cleanupSessionArtifacts({ ...options, planId, maxRemovals: 1 });
    assert.equal(result.removed.length, 1);
    assert.equal(result.limitReached, batch === 0);
    removed.push(...result.removed);
  }
  assert.deepEqual(removed.sort(), [temporary, second].sort());
  assert.deepEqual((await cleanupSessionArtifacts({ ...options, planId })).removed, []);
});

test("cancellation after a root deletion still syncs the changed directory and preserves its reason", async (t) => {
  const { sessionDir, options } = await fixture(t);
  const files = ["head.json", "immutable-session.format"].map((name) =>
    immutablePublicationTemporaryFile(path.join(sessionDir, name), token),
  );
  for (const file of files) await writeFile(file, "partial");
  const { planId } = await prepareSessionArtifactCleanup({ ...options, dryRun: false });
  const controller = new AbortController();
  const reason = new Error("cancel after deletion");
  Object.defineProperty(controller.signal, "throwIfAborted", {
    value() {
      if (files.some((file) => !existsSync(file))) controller.abort(reason);
      AbortSignal.prototype.throwIfAborted.call(this);
    },
  });
  let rootSyncs = 0;
  setFsAdapter({
    open: async (file, flags, ...args) => {
      const handle = await open(file, flags, ...args);
      if (file === sessionDir && flags === "r") {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          rootSyncs += 1;
          return sync();
        };
      }
      return handle;
    },
  });
  t.after(resetFsAdapter);
  await assert.rejects(
    cleanupSessionArtifacts({ ...options, planId, signal: controller.signal }),
    (error) => error === reason,
  );
  assert.equal(rootSyncs, 1);
  assert.equal(files.filter(existsSync).length, 1);
});
