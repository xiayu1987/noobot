/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, access, readFile, writeFile, open, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  decodeImmutableCleanupRecord,
  encodeImmutableCleanupRecord,
} from "@noobot/session-protocol/immutable-storage";
import {
  prepareSessionArtifactCleanup,
  cleanupSessionArtifacts,
  discardSessionArtifactCleanup,
} from "../../src/session/session-artifact-maintenance.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { observeSessionStorageWork } from "../../src/session/session-artifact-session/storage-transaction.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { acquireImmutableReaderRetention } from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";

function segmentFile(store, reference) {
  return store.objects.segments.segmentPath(decodeImmutableRecordReference(reference).segmentId);
}

async function fixture(t, count = 1) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "cleanup-plan-"));
  const resources = new AsyncDisposableStack();
  t.after(() => resources.disposeAsync());
  resources.defer(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "plan-session",
    allowCreate: true,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "first",
    changes: [
      { collection: "messages", key: "m", value: "old" },
      { collection: "outbox", key: "pending", value: { eventId: "pending", deliveries: {} } },
    ],
  });
  const snapshot = await store.snapshot();
  const retention = await acquireImmutableReaderRetention(store, async () => {});
  resources.defer(() => retention.release());
  await store.commit({
    expectedGeneration: 1,
    operationId: "second",
    changes: [{ collection: "messages", key: "m", value: "current" }],
  });
  const options = { storageService, sessionDir, assertSessionWritable: async () => {} };
  const baseline = await prepareSessionArtifactCleanup({ ...options, dryRun: false });
  assert.equal(
    (await cleanupSessionArtifacts({ ...options, planId: baseline.planId })).complete,
    true,
  );
  await discardSessionArtifactCleanup({ ...options, planId: baseline.planId });
  const orphans = [];
  for (let i = 0; i < count; i += 1) {
    const batch = store.objects.segments.createBatch();
    try {
      const reference = batch.stage(Buffer.from(JSON.stringify(`orphan-${i}`)));
      await batch.publish([reference]);
      orphans.push(reference);
    } finally {
      batch.release();
    }
  }
  const plan = await prepareSessionArtifactCleanup({ ...options, dryRun: false });
  const directory = path.join(sessionDir, PLAN.directory, plan.planId);
  return { sessionDir, store, snapshot, orphans, options, plan, directory };
}

test("a persistent plan advances with candidate budget one and preserves historical readers and pending outbox", async (t) => {
  const { store, snapshot, orphans, options, plan } = await fixture(t, 35);
  assert.equal(plan.candidates, orphans.length);
  let processed = 0;
  let removed = 0;
  for (let i = 0; i < plan.candidates; i += 1) {
    const { result, work } = await observeSessionStorageWork(() =>
      cleanupSessionArtifacts({
        ...options,
        planId: plan.planId,
        maxCandidates: 1,
      }),
    );
    assert.equal(result.processedCandidates, 1);
    assert.equal(result.processed, ++processed);
    assert.equal(result.complete, processed === plan.candidates);
    assert.equal(work.immutableObjectReads ?? 0, 0);
    removed += result.removed.length;
  }
  assert.equal(removed, plan.candidates);
  const reopened = await ImmutableSessionStore.open({ sessionDir: options.sessionDir });
  assert.equal(await reopened.get(snapshot, "messages", "m"), "old");
  const current = await reopened.snapshot();
  assert.equal(await reopened.get(current, "messages", "m"), "current");
  assert.equal((await reopened.get(current, "outbox", "pending")).eventId, "pending");
  await assert.rejects(access(segmentFile(store, orphans[0])), { code: "ENOENT" });
  assert.equal((await cleanupSessionArtifacts({ ...options, planId: plan.planId })).complete, true);
});

test("a different process resumes exactly the durable cursor without preparing another plan", async (t) => {
  const { options, plan, directory } = await fixture(t, 2);
  await cleanupSessionArtifacts({ ...options, planId: plan.planId, maxCandidates: 1 });
  const source = `
    import { cleanupSessionArtifacts } from ${JSON.stringify(new URL("../../src/session/session-artifact-maintenance.js", import.meta.url).href)};
    import { TEST_STORAGE_SERVICE as storageService } from ${JSON.stringify(new URL("../helpers/storage-service.js", import.meta.url).href)};
    const result = await cleanupSessionArtifacts({ storageService, sessionDir: process.argv[1], planId: process.argv[2], maxCandidates: 1, assertSessionWritable: async () => {} });
    process.stdout.write(JSON.stringify(result));
  `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      new URL("../../../shared/testing/runtime-params.js", import.meta.url).href,
      "--input-type=module",
      "--eval",
      source,
      options.sessionDir,
      plan.planId,
    ],
    { timeout: 15000 },
  );
  assert.equal(JSON.parse(stdout).processed, 2);
  const progress = decodeImmutableCleanupRecord(
    await readFile(path.join(directory, PLAN.progress), "utf8"),
  );
  assert.equal(progress.processed, 2);
  assert.equal((await cleanupSessionArtifacts({ ...options, planId: plan.planId })).complete, true);
});

test("an ancestor plan deletes old orphans while preserving equal content adopted by a new commit", async (t) => {
  const { store, orphans, options, plan } = await fixture(t);
  await store.transact({
    expectedGeneration: 2,
    operationId: "publish-orphan",
    input: {},
    prepare: async () => {
      const value = await store.objects.putValue("orphan-0");
      const root = await store.index.set(null, "member", value);
      return {
        changes: [{ collection: "dialogTurns", key: "formerly-orphan", value: { root, count: 1 } }],
      };
    },
  });
  const result = await cleanupSessionArtifacts({ ...options, planId: plan.planId });
  assert.equal(result.complete, true);
  assert.equal(result.historyProofLookups, 1);
  await assert.rejects(access(segmentFile(store, orphans[0])), { code: "ENOENT" });
  await discardSessionArtifactCleanup({ ...options, planId: plan.planId });
  const replacement = await prepareSessionArtifactCleanup({ ...options, dryRun: false });
  assert.equal(
    (await cleanupSessionArtifacts({ ...options, planId: replacement.planId })).complete,
    true,
  );
  await assert.rejects(access(segmentFile(store, orphans[0])), { code: "ENOENT" });
  const current = await store.snapshot();
  const membership = await store.get(current, "dialogTurns", "formerly-orphan");
  await store.objects.withSnapshot(current, async () => {
    assert.equal(
      await store.objects.readValue(await store.index.get(membership.root, "member")),
      "orphan-0",
    );
  });
});

test("an interrupted cursor publication retries completed deletions safely", async (t) => {
  const { options, plan, directory } = await fixture(t);
  const progressPath = path.join(directory, PLAN.progress);
  const before = await readFile(progressPath);
  setFsAdapter({
    open: async (file, flags, ...args) => {
      if (flags === "wx" && String(file).startsWith(`${progressPath}.`))
        throw new Error("cursor publication failed");
      return open(file, flags, ...args);
    },
  });
  t.after(resetFsAdapter);
  await assert.rejects(
    cleanupSessionArtifacts({ ...options, planId: plan.planId, maxCandidates: 1 }),
    /cursor publication failed/,
  );
  resetFsAdapter();
  assert.deepEqual(await readFile(progressPath), before);
  const result = await cleanupSessionArtifacts({ ...options, planId: plan.planId });
  assert.equal(result.processed, plan.candidates);
  assert.equal(result.removed.length, plan.candidates - 1);
  assert.equal(result.complete, true);
});

test("corrupt plan records and chunks refuse deletion, and foreign plan paths are rejected", async (t) => {
  const { store, orphans, options, plan, directory } = await fixture(t);
  const manifest = decodeImmutableCleanupRecord(
    await readFile(path.join(directory, PLAN.manifest), "utf8"),
  );
  await writeFile(path.join(directory, `${manifest.firstChunk}.json`), "corrupted");
  await assert.rejects(cleanupSessionArtifacts({ ...options, planId: plan.planId }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await access(segmentFile(store, orphans[0]));
  await assert.rejects(cleanupSessionArtifacts({ ...options, planId: "../head.json" }), TypeError);
  await discardSessionArtifactCleanup({ ...options, planId: plan.planId });
  await assert.rejects(access(directory), { code: "ENOENT" });
});

test("a changed candidate file type fails visibly and does not follow a symlink", async (t) => {
  const { store, orphans, options, plan, directory } = await fixture(t);
  const manifest = decodeImmutableCleanupRecord(
    await readFile(path.join(directory, PLAN.manifest), "utf8"),
  );
  const chunk = decodeImmutableCleanupRecord(
    await readFile(path.join(directory, `${manifest.firstChunk}.json`), "utf8"),
  );
  const first = path.join(options.sessionDir, chunk.files[0]);
  await rm(first);
  await symlink(store.headPath, first);
  await assert.rejects(
    cleanupSessionArtifacts({ ...options, planId: plan.planId }),
    /changed its file type/,
  );
  await access(segmentFile(store, orphans[0]));
  assert.equal((await store.snapshot()).generation, 2);
});

test("dry-run plans have their own durable progress and never consume an execution plan", async (t) => {
  const { store, orphans, options, plan } = await fixture(t);
  const preview = await prepareSessionArtifactCleanup({ ...options, dryRun: true });
  const result = await cleanupSessionArtifacts({ ...options, planId: preview.planId });
  assert.equal(result.dryRun, true);
  assert.equal(result.complete, true);
  await access(segmentFile(store, orphans[0]));
  const executed = await cleanupSessionArtifacts({ ...options, planId: plan.planId });
  assert.equal(executed.removed.length, plan.candidates);
});

test("a concurrent commit during preparation preserves publication and newly committed content", async (t) => {
  const { store, options, orphans } = await fixture(t);
  const head = await store.snapshot();
  let advanced = false;
  setFsAdapter({
    open: async (file, flags, ...args) => {
      if (
        !advanced &&
        flags === "r" &&
        String(file).startsWith(store.objects.segments.directory + path.sep)
      ) {
        advanced = true;
        await store.commit({
          expectedGeneration: head.generation,
          operationId: "during-prepare",
          changes: [{ collection: "messages", key: "new", value: "orphan-0" }],
        });
      }
      return open(file, flags, ...args);
    },
  });
  t.after(resetFsAdapter);
  const concurrentPlan = await prepareSessionArtifactCleanup({ ...options, dryRun: false });
  resetFsAdapter();
  assert.equal(advanced, true);
  await access(segmentFile(store, orphans[0]));
  assert.equal((await store.snapshot()).generation, head.generation + 1);
  const result = await cleanupSessionArtifacts({ ...options, planId: concurrentPlan.planId });
  assert.equal(result.complete, true);
  assert.equal(result.historyProofLookups, 1);
  const reopened = await ImmutableSessionStore.open({ sessionDir: options.sessionDir });
  assert.equal(await reopened.get(await reopened.snapshot(), "messages", "new"), "orphan-0");
  await assert.rejects(access(segmentFile(store, orphans[0])), { code: "ENOENT" });
});

test("a directory sync failure leaves the cursor unchanged and recovery syncs the absent candidate", async (t) => {
  const { options, plan, directory } = await fixture(t);
  const manifest = decodeImmutableCleanupRecord(
    await readFile(path.join(directory, PLAN.manifest), "utf8"),
  );
  const chunk = decodeImmutableCleanupRecord(
    await readFile(path.join(directory, `${manifest.firstChunk}.json`), "utf8"),
  );
  const candidate = path.join(options.sessionDir, chunk.files[0]);
  const candidateDirectory = path.dirname(candidate);
  const progressPath = path.join(directory, PLAN.progress);
  const before = await readFile(progressPath);
  let syncs = 0;
  const adapter = (fail) => ({
    open: async (file, flags, ...args) => {
      const handle = await open(file, flags, ...args);
      if (String(file) === candidateDirectory && flags === "r") {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          syncs += 1;
          if (fail) throw new Error("candidate directory sync failed");
          return sync();
        };
      }
      return handle;
    },
  });
  setFsAdapter(adapter(true));
  t.after(resetFsAdapter);
  await assert.rejects(
    cleanupSessionArtifacts({ ...options, planId: plan.planId, maxCandidates: 1 }),
    /candidate directory sync failed/,
  );
  assert.deepEqual(await readFile(progressPath), before);
  await assert.rejects(access(candidate), { code: "ENOENT" });
  setFsAdapter(adapter(false));
  const result = await cleanupSessionArtifacts({
    ...options,
    planId: plan.planId,
    maxCandidates: 1,
  });
  assert.equal(result.processed, 1);
  assert.deepEqual(result.removed, []);
  assert.equal(syncs, 2);
});

test("concurrent consumers serialize one durable cursor without duplicating candidates", async (t) => {
  const { options, plan } = await fixture(t, 2);
  const results = await Promise.all(
    Array.from({ length: plan.candidates }, () =>
      cleanupSessionArtifacts({ ...options, planId: plan.planId, maxCandidates: 1 }),
    ),
  );
  assert.deepEqual(
    results.map((result) => result.processed).sort((a, b) => a - b),
    Array.from({ length: plan.candidates }, (_, index) => index + 1),
  );
  assert.equal(new Set(results.flatMap((result) => result.removed)).size, plan.candidates);
  assert.equal(results.filter((result) => result.complete).length, 1);
});

test("legacy execution fields are rejected without advancing a valid plan", async (t) => {
  const { options, plan, directory } = await fixture(t);
  const progressPath = path.join(directory, PLAN.progress);
  const before = await readFile(progressPath);
  for (const fields of [
    { maxDirectoryEntries: 1 },
    { maxObjectReads: 1 },
    { dryRun: true },
    { alreadyLocked: true },
  ]) {
    await assert.rejects(
      cleanupSessionArtifacts({ ...options, planId: plan.planId, ...fields }),
      TypeError,
    );
  }
  assert.deepEqual(await readFile(progressPath), before);
  assert.equal((await cleanupSessionArtifacts({ ...options, planId: plan.planId })).complete, true);
});

test("inconsistent cursor and page counts reject before deletion even with valid record checksums", async (t) => {
  const { options, plan, directory, store, orphans } = await fixture(t);
  const progressPath = path.join(directory, PLAN.progress);
  const originalProgress = await readFile(progressPath, "utf8");
  const progress = decodeImmutableCleanupRecord(originalProgress);
  await writeFile(
    progressPath,
    encodeImmutableCleanupRecord({ ...progress, processed: plan.candidates }),
  );
  await assert.rejects(cleanupSessionArtifacts({ ...options, planId: plan.planId }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await access(segmentFile(store, orphans[0]));
  await writeFile(progressPath, originalProgress);

  const manifestPath = path.join(directory, PLAN.manifest);
  const manifest = decodeImmutableCleanupRecord(await readFile(manifestPath, "utf8"));
  const bytes = encodeImmutableCleanupRecord({ ...manifest, candidates: manifest.candidates + 1 });
  await writeFile(manifestPath, bytes);
  await writeFile(
    progressPath,
    encodeImmutableCleanupRecord({
      ...progress,
      plan: createHash("sha256").update(bytes).digest("hex"),
    }),
  );
  await assert.rejects(cleanupSessionArtifacts({ ...options, planId: plan.planId }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await access(segmentFile(store, orphans[0]));
  assert.equal(
    (await readdir(store.objects.segments.directory)).includes(
      path.basename(segmentFile(store, orphans[0])),
    ),
    true,
  );
});

test("discard retries directory durability after its plan directory was removed", async (t) => {
  const { options, plan, directory, store, orphans } = await fixture(t);
  const head = await readFile(store.headPath);
  const parent = path.dirname(directory);
  let syncs = 0;
  setFsAdapter({
    open: async (file, flags, ...args) => {
      const handle = await open(file, flags, ...args);
      if (String(file) === parent && flags === "r") {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          syncs += 1;
          if (syncs === 1) throw new Error("discard directory sync failed");
          return sync();
        };
      }
      return handle;
    },
  });
  t.after(resetFsAdapter);
  const request = { ...options, planId: plan.planId };
  await assert.rejects(discardSessionArtifactCleanup(request), /discard directory sync failed/);
  await assert.rejects(access(directory), { code: "ENOENT" });
  assert.deepEqual(await discardSessionArtifactCleanup(request), {
    planId: plan.planId,
    discarded: true,
  });
  assert.equal(syncs, 2);
  assert.deepEqual(await readFile(store.headPath), head);
  await access(segmentFile(store, orphans[0]));
});

test("a durable plan resumes between continued commits and record relocation with an old reader", async (t) => {
  const { options, plan, store, snapshot, orphans } = await fixture(t, 4);
  const before = await store.snapshot();
  const oldLocation = await store.objects.locations.get(before.locationRoot, before.commit);
  await store.transact({
    expectedGeneration: before.generation,
    operationId: "relocate-during-cleanup",
    input: {},
    prepare: async () => {
      await store.objects.relocate({ identity: before.commit, sourceLocation: oldLocation });
      return { changes: [{ collection: "metadata", key: "relocated", value: true }] };
    },
  });
  const relocated = await store.snapshot();
  assert.notEqual(
    await store.objects.locations.get(relocated.locationRoot, before.commit),
    oldLocation,
  );
  for (let index = 0; index < plan.candidates; index += 1) {
    const current = await store.snapshot();
    await store.commit({
      expectedGeneration: current.generation,
      operationId: `continued-${index}`,
      changes: [{ collection: "messages", key: `new-${index}`, value: `body-${index}` }],
    });
    const result = await cleanupSessionArtifacts({
      ...options,
      planId: plan.planId,
      maxCandidates: 1,
    });
    assert.equal(result.processed, index + 1);
    assert.equal(result.historyProofLookups, 1);
    assert.equal(result.complete, index + 1 === plan.candidates);
  }
  const reopened = await ImmutableSessionStore.open({ sessionDir: options.sessionDir });
  assert.equal(await reopened.get(snapshot, "messages", "m"), "old");
  const latest = await reopened.snapshot();
  for (let index = 0; index < plan.candidates; index += 1)
    assert.equal(await reopened.get(latest, "messages", `new-${index}`), `body-${index}`);
  for (const orphan of orphans)
    await assert.rejects(access(segmentFile(store, orphan)), { code: "ENOENT" });
});

test("a legacy plan is rejected before deleting candidates or advancing its durable cursor", async (t) => {
  const { options, plan, directory, store, orphans } = await fixture(t);
  const manifestPath = path.join(directory, PLAN.manifest);
  const manifest = decodeImmutableCleanupRecord(await readFile(manifestPath, "utf8"));
  const progressPath = path.join(directory, PLAN.progress);
  const progress = await readFile(progressPath);
  await writeFile(
    manifestPath,
    encodeImmutableCleanupRecord({ ...manifest, format: "noobot.immutable-cleanup/1" }),
  );
  await assert.rejects(cleanupSessionArtifacts({ ...options, planId: plan.planId }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  assert.deepEqual(await readFile(progressPath), progress);
  await access(segmentFile(store, orphans[0]));
  await discardSessionArtifactCleanup({ ...options, planId: plan.planId });
});

test("corrupted or unpublished plan scratch can be explicitly discarded without trusting its contents", async (t) => {
  const { options, plan, directory, store, orphans } = await fixture(t);
  await writeFile(path.join(directory, PLAN.manifest), "corrupted");
  await assert.rejects(cleanupSessionArtifacts({ ...options, planId: plan.planId }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await discardSessionArtifactCleanup({ ...options, planId: plan.planId });
  await assert.rejects(access(directory), { code: "ENOENT" });
  await access(segmentFile(store, orphans[0]));
});
