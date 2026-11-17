/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableLocatedRecordStore } from "../../src/session/session-artifact-session/immutable-located-record-store.js";
import { applyImmutableCleanupPlan } from "../../src/session/session-artifact-session/immutable-cleanup-plan.js";
import { immutableOwnedInventory } from "../../src/session/session-artifact-session/immutable-object-garbage.js";
import { capturedImmutableCandidates } from "../helpers/immutable-cleanup-candidates.js";
import { contentDigest } from "../../src/session/session-artifact-session/immutable-storage-io.js";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  encodeImmutableCleanupRecord,
  decodeImmutableCleanupBytes,
  requireImmutableCleanupManifest,
} from "@noobot/session-protocol/immutable-storage";

const planId = "00000000-0000-0000-0000-000000000002";

async function fixture(t, { dryRun = false, planHead = (head) => head } = {}) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-segment-cleanup-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "segments",
    allowCreate: true,
    objectStore: ImmutableLocatedRecordStore,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "metadata", key: "session", value: { sessionId: "segments" } }],
  });
  const head = await store.snapshot();
  for (let i = 0; i < 2; i++) {
    const batch = store.objects.segments.createBatch();
    const reference = batch.stage(Buffer.from(`abandoned ${i}`));
    await batch.publish([reference]);
  }
  let retainedSegments = null;
  const files = await Array.fromAsync(
    capturedImmutableCandidates({
      sessionDir,
      retainedHeads: [head],
      retentionDirectory: path.join(sessionDir, PLAN.directory, planId, PLAN.retentionDirectory),
      objects: store.objects,
      format: head.format,
      inventory: immutableOwnedInventory({ sessionDir, format: head.format }),
      onRetainedSegments: (count) => {
        retainedSegments = count;
      },
    }),
  );
  assert.equal(files.length, 2);
  assert.ok(retainedSegments >= 1);
  const directory = path.join(sessionDir, PLAN.directory, planId);
  await mkdir(directory, { recursive: true });
  const chunk = encodeImmutableCleanupRecord({ previous: null, files });
  const firstChunk = contentDigest(chunk);
  const manifest = encodeImmutableCleanupRecord(
    requireImmutableCleanupManifest(
      {
        format: PLAN.format,
        id: planId,
        head: planHead(head),
        dryRun,
        candidates: files.length,
        firstChunk,
        retainedSegments,
      },
      planId,
    ),
  );
  await writeFile(path.join(directory, `${firstChunk}.json`), chunk);
  await writeFile(
    path.join(directory, PLAN.progress),
    encodeImmutableCleanupRecord({
      plan: contentDigest(manifest),
      chunk: firstChunk,
      offset: 0,
      processed: 0,
    }),
  );
  await writeFile(path.join(directory, PLAN.manifest), manifest);
  return { store, sessionDir, directory, head, files };
}

function apply(sessionDir) {
  return applyImmutableCleanupPlan({ sessionDir, planId, maxCandidates: 1, maxRemovals: 1 });
}

test("segment deletion resumes from the durable cursor with no graph reads and preserves live records", async (t) => {
  const { store, sessionDir, directory, files } = await fixture(t);
  const before = await readFile(store.headPath);
  const first = await apply(sessionDir);
  assert.equal(first.complete, false);
  assert.equal(first.processed, 1);
  assert.equal(first.historyProofLookups, 0);
  const persisted = decodeImmutableCleanupBytes(
    await readFile(path.join(directory, PLAN.progress)),
  );
  assert.equal(persisted.processed, 1);
  const second = await apply(sessionDir);
  assert.equal(second.complete, true);
  assert.equal(second.processed, 2);
  const retry = await apply(sessionDir);
  assert.equal(retry.complete, true);
  assert.equal(retry.processedCandidates, 0);
  assert.deepEqual(await readFile(store.headPath), before);
  for (const file of files)
    await assert.rejects(access(path.join(sessionDir, file)), { code: "ENOENT" });
  assert.deepEqual(await store.get(await store.snapshot(), "metadata", "session"), {
    sessionId: "segments",
  });
});

test("segment dry-run advances its durable cursor without deleting candidates", async (t) => {
  const { sessionDir, files } = await fixture(t, { dryRun: true });
  assert.equal((await apply(sessionDir)).complete, false);
  assert.equal((await apply(sessionDir)).complete, true);
  for (const file of files) await access(path.join(sessionDir, file));
});

test("a descendant commit keeps an ancestor plan valid without adopting its candidates", async (t) => {
  const { store, sessionDir, head, files } = await fixture(t);
  await store.commit({
    expectedGeneration: head.generation,
    operationId: "advance",
    changes: [
      { collection: "metadata", key: "session", value: { sessionId: "segments", label: "new" } },
    ],
  });
  while (!(await apply(sessionDir)).complete) {
    continue;
  }
  for (const file of files)
    await assert.rejects(access(path.join(sessionDir, file)), { code: "ENOENT" });
  assert.deepEqual(await store.get(await store.snapshot(), "metadata", "session"), {
    sessionId: "segments",
    label: "new",
  });
});

test("a plan whose head is not an ancestor of current history is rejected before deletion", async (t) => {
  const { sessionDir, files } = await fixture(t, {
    planHead: (head) => ({ ...head, commit: head.operations }),
  });
  await assert.rejects(apply(sessionDir), { code: "SESSION_MAINTENANCE_PLAN_STALE" });
  for (const file of files) await access(path.join(sessionDir, file));
});
