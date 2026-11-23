/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sessionMutationCoordinator } from "../../src/session/session-mutation-coordinator.js";
import { resolveImmutableCleanupPlanMutationLock } from "../../src/session/session-artifact-session/immutable-cleanup-coordinator.js";
import {
  IMMUTABLE_CLEANUP_PLAN as PLAN,
  IMMUTABLE_READER_RETENTION as RETENTION,
  requireImmutableCleanupPreparation,
  decodeImmutableCleanupBytes,
  encodeImmutableCleanupRecord,
} from "@noobot/session-protocol/immutable-storage";
import { decodeImmutableRecordReference } from "@noobot/session-protocol/immutable-segment";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { readImmutableReaderRetentions } from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import {
  compactSessionArtifacts,
  prepareSessionArtifactCleanup,
  cleanupSessionArtifacts,
  discardSessionArtifactCleanup,
} from "../../src/session/session-artifact-maintenance.js";
import { auditImmutableSession } from "../../src/session/session-artifact-session/immutable-session-audit.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { prepareSessionArtifactCleanupToCompletion } from "../helpers/immutable-cleanup.js";
import { holdSessionLock } from "../helpers/session-lock-process.js";

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "cleanup-preparation-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "preparation",
    allowCreate: true,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "metadata", key: "item", value: "retained" }],
  });
  const options = { storageService, sessionDir, assertSessionWritable: async () => {} };
  return { store, sessionDir, options };
}

async function cleanup(options) {
  const plan = await prepareSessionArtifactCleanupToCompletion({ ...options, dryRun: false });
  try {
    const result = await cleanupSessionArtifacts({ ...options, planId: plan.planId });
    assert.equal(result.complete, true);
  } finally {
    await discardSessionArtifactCleanup({ ...options, planId: plan.planId });
  }
}

test("process exit preserves plan-owned roots through relocation and cleanup until explicit discard", async (t) => {
  const { store, sessionDir, options } = await fixture(t);
  const before = await store.snapshot();
  const module = new URL(
    "../../src/session/session-artifact-session/immutable-cleanup-plan.js",
    import.meta.url,
  ).href;
  await promisify(execFile)(process.execPath, [
    "--import",
    new URL("../../../shared/testing/runtime-params.js", import.meta.url).href,
    "--input-type=module",
    "-e",
    `import { buildImmutableCleanupPlan } from ${JSON.stringify(module)};
     await buildImmutableCleanupPlan({ sessionDir: process.argv[1], dryRun: false,
       publish: async () => process.exit(0) });
     throw new Error('preparation unexpectedly returned');`,
    sessionDir,
  ]);
  const [planId] = await readdir(path.join(sessionDir, PLAN.directory));
  const directory = path.join(sessionDir, PLAN.directory, planId);
  const record = requireImmutableCleanupPreparation(
    decodeImmutableCleanupBytes(await readFile(path.join(directory, PLAN.preparation))),
    planId,
  );
  assert.deepEqual(record.heads, [before]);
  await assert.rejects(readFile(path.join(directory, PLAN.manifest)), { code: "ENOENT" });
  await assert.rejects(readdir(path.join(sessionDir, RETENTION.directory)), { code: "ENOENT" });
  const lockPath = resolveImmutableCleanupPlanMutationLock(sessionDir, planId);
  const lock = await stat(lockPath);
  const ownership = await readFile(path.join(directory, PLAN.preparation));
  const capture = await readFile(path.join(directory, PLAN.capture));
  const stop = await holdSessionLock(lockPath);
  const timingMock = t.mock.method(sessionMutationCoordinator, "readTiming", () => ({
    timeoutMs: 50,
    pollMs: 5,
  }));
  try {
    for (const run of [
      () => prepareSessionArtifactCleanup({ ...options, planId, dryRun: false }),
      () => cleanupSessionArtifacts({ ...options, planId }),
      () => discardSessionArtifactCleanup({ ...options, planId }),
    ]) {
      await assert.rejects(run(), { code: "SESSION_MUTATION_BUSY" });
      assert.deepEqual(await readFile(path.join(directory, PLAN.preparation)), ownership);
      assert.deepEqual(await readFile(path.join(directory, PLAN.capture)), capture);
    }
  } finally {
    timingMock.mock.restore();
    await stop();
  }
  const oldFile = store.objects.segments.segmentPath(before.segmentTail.segmentId);
  const body = Array.from(
    { length: 80 },
    (_, i) => `${i}:` + String.fromCharCode(33 + i).repeat(65536),
  ).join("");
  await store.commit({
    expectedGeneration: before.generation,
    operationId: "rollover",
    changes: [{ collection: "metadata", key: "large", value: body }],
  });
  const snapshot = await store.snapshot();
  assert.notEqual(snapshot.segmentTail.segmentId, before.segmentTail.segmentId);
  const sources = [];
  for await (const [identity, sourceLocation] of store.objects.locations.entries(
    snapshot.locationRoot,
  ))
    if (decodeImmutableRecordReference(sourceLocation).segmentId === before.segmentTail.segmentId)
      sources.push({ identity, sourceLocation });
  assert.ok(sources.length > 0);
  for (let offset = 0; offset < sources.length; offset += 8)
    await compactSessionArtifacts({
      ...options,
      expectedGeneration: (await store.snapshot()).generation,
      operationId: `evacuate-${offset}`,
      records: sources.slice(offset, offset + 8),
    });
  const reopened = await ImmutableSessionStore.open({ sessionDir });
  assert.deepEqual(await readImmutableReaderRetentions(reopened, await reopened.snapshot()), [
    before,
  ]);
  await cleanup(options);
  await readFile(oldFile);
  assert.equal(await reopened.get(before, "metadata", "item"), "retained");
  await discardSessionArtifactCleanup({ ...options, planId });
  assert.equal((await stat(lockPath)).ino, lock.ino);
  await assert.rejects(readFile(path.join(directory, PLAN.preparation)), { code: "ENOENT" });
  assert.deepEqual(await readImmutableReaderRetentions(reopened, await reopened.snapshot()), []);
  await cleanup(options);
  await assert.rejects(readFile(oldFile), { code: "ENOENT" });
  assert.equal(await reopened.get(await reopened.snapshot(), "metadata", "item"), "retained");
  assert.equal((await auditImmutableSession({ sessionDir })).ok, true);
});

test("preparation ownership rejects malformed, duplicate and foreign snapshots", async (t) => {
  const { store } = await fixture(t);
  const head = await store.snapshot();
  const id = randomUUID();
  const record = { format: PLAN.preparationFormat, id, heads: [head] };
  assert.equal(requireImmutableCleanupPreparation(record, id), record);
  for (const invalid of [
    { ...record, heads: [] },
    { ...record, heads: [head, head] },
    { ...record, heads: [head, { ...head, sessionId: "foreign" }] },
    { ...record, id: randomUUID() },
    { ...record, extra: true },
  ])
    assert.throws(() => requireImmutableCleanupPreparation(invalid, id));
});

test("damaged preparation ownership blocks cleanup instead of dropping retained roots", async (t) => {
  const { store, sessionDir, options } = await fixture(t);
  const id = randomUUID();
  const directory = path.join(sessionDir, PLAN.directory, id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, PLAN.preparation), "damaged");
  const before = await readFile(store.headPath);
  let interruptedPlanId;
  await assert.rejects(prepareSessionArtifactCleanup({ ...options, dryRun: false }), (error) => {
    assert.equal(error.code, "SESSION_MAINTENANCE_PREPARATION_INTERRUPTED");
    assert.equal(error.cause.code, "SESSION_IMMUTABLE_STORAGE_INVALID");
    interruptedPlanId = error.planId;
    return true;
  });
  assert.deepEqual(await readFile(store.headPath), before);
  await discardSessionArtifactCleanup({ ...options, planId: interruptedPlanId });
  assert.deepEqual(await readdir(path.join(sessionDir, PLAN.directory)), [id]);
  await writeFile(
    path.join(directory, PLAN.preparation),
    encodeImmutableCleanupRecord({
      format: PLAN.preparationFormat,
      id,
      heads: [{ ...(await store.snapshot()), sessionId: "foreign" }],
    }),
  );
  await assert.rejects(readImmutableReaderRetentions(store, await store.snapshot()));
  await discardSessionArtifactCleanup({ ...options, planId: id });
  await cleanup(options);
});

async function startPagedPreparation(t) {
  const fixtureState = await fixture(t);
  const { store, options } = fixtureState;
  await store.commit({
    expectedGeneration: 1,
    operationId: "branch-location-index",
    changes: Array.from({ length: 160 }, (_, i) => ({
      collection: "metadata",
      key: `key-${i}`,
      value: `value-${i}`,
    })),
  });
  const prepared = await prepareSessionArtifactCleanup({
    ...options,
    dryRun: false,
    maxMarkingPages: 1,
  });
  assert.equal(prepared.complete, false);
  assert.equal(prepared.scannedPages, 1);
  return { ...fixtureState, prepared };
}

test("preparation entry resumes in a new process and published retries preserve deletion progress", async (t) => {
  const { store, sessionDir, options, prepared } = await startPagedPreparation(t);
  const directory = path.join(sessionDir, PLAN.directory, prepared.planId);
  const ownership = await readFile(path.join(directory, PLAN.preparation));
  await store.commit({
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "write-between-marking-batches",
    changes: [{ collection: "metadata", key: "later", value: true }],
  });
  const maintenance = new URL("../../src/session/session-artifact-maintenance.js", import.meta.url)
    .href;
  const service = new URL("../helpers/storage-service.js", import.meta.url).href;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      new URL("../../../shared/testing/runtime-params.js", import.meta.url).href,
      "--input-type=module",
      "-e",
      `import { prepareSessionArtifactCleanup } from ${JSON.stringify(maintenance)};
     import { TEST_STORAGE_SERVICE } from ${JSON.stringify(service)};
     const options = { storageService: TEST_STORAGE_SERVICE, sessionDir: process.argv[1],
       planId: process.argv[2], dryRun: false, maxMarkingPages: 1,
       assertSessionWritable: async () => {} };
     let result;
     for (let i = 0; i < 1000; i++) {
       result = await prepareSessionArtifactCleanup(options);
       if (result.complete) break;
       if (result.scannedPages !== 1) throw new Error('page budget not respected');
     }
     if (!result.complete) throw new Error('preparation did not finish');
     console.log(JSON.stringify(result));`,
      sessionDir,
      prepared.planId,
    ],
    { timeout: 15000 },
  );
  const completed = JSON.parse(stdout);
  assert.equal(completed.complete, true);
  await assert.rejects(readFile(path.join(directory, PLAN.preparation)), { code: "ENOENT" });
  assert.ok(ownership.length > 0);
  const applied = await cleanupSessionArtifacts({
    ...options,
    planId: prepared.planId,
    maxCandidates: 1,
  });
  const progress = await readFile(path.join(directory, PLAN.progress));
  const retried = await prepareSessionArtifactCleanup({
    ...options,
    planId: prepared.planId,
    dryRun: false,
    maxMarkingPages: 1,
  });
  assert.deepEqual(retried, completed);
  assert.deepEqual(await readFile(path.join(directory, PLAN.progress)), progress);
  assert.equal(
    (await cleanupSessionArtifacts({ ...options, planId: prepared.planId })).processed >=
      applied.processed,
    true,
  );
  assert.equal(await store.get(await store.snapshot(), "metadata", "later"), true);
  assert.equal((await auditImmutableSession({ sessionDir })).ok, true);
});

test("failed preparation resumption preserves ownership and the durable marking checkpoint", async (t) => {
  const { sessionDir, options, prepared } = await startPagedPreparation(t);
  const directory = path.join(sessionDir, PLAN.directory, prepared.planId);
  const checkpoint = path.join(directory, PLAN.retentionDirectory, PLAN.retentionState);
  const before = await readFile(checkpoint);
  const ownership = await readFile(path.join(directory, PLAN.preparation));
  const controller = new AbortController();
  controller.abort(new Error("interrupt preparation"));
  await assert.rejects(
    prepareSessionArtifactCleanup({
      ...options,
      planId: prepared.planId,
      dryRun: false,
      maxMarkingPages: 1,
      signal: controller.signal,
    }),
    /interrupt preparation/,
  );
  await assert.rejects(
    prepareSessionArtifactCleanup({
      ...options,
      planId: prepared.planId,
      dryRun: true,
      maxMarkingPages: 1,
    }),
    /dryRun/,
  );
  assert.deepEqual(await readFile(checkpoint), before);
  assert.deepEqual(await readFile(path.join(directory, PLAN.preparation)), ownership);
  await discardSessionArtifactCleanup({ ...options, planId: prepared.planId });
  await assert.rejects(readdir(directory), { code: "ENOENT" });
});

test("preparation resumption rejects missing and old retention checkpoints without recreating protection", async (t) => {
  const { sessionDir, options, prepared } = await startPagedPreparation(t);
  const directory = path.join(sessionDir, PLAN.directory, prepared.planId);
  const checkpoint = path.join(directory, PLAN.retentionDirectory, PLAN.retentionState);
  const before = await readFile(checkpoint);
  await rm(checkpoint);
  const resume = () =>
    prepareSessionArtifactCleanup({
      ...options,
      planId: prepared.planId,
      dryRun: false,
      maxMarkingPages: 1,
    });
  await assert.rejects(resume(), { code: "ENOENT" });
  await assert.rejects(readFile(checkpoint), { code: "ENOENT" });
  const old = { ...decodeImmutableCleanupBytes(before), format: "noobot.cleanup-retention/1" };
  await writeFile(checkpoint, encodeImmutableCleanupRecord(old));
  await assert.rejects(resume(), { code: "SESSION_IMMUTABLE_STORAGE_INVALID" });
  await writeFile(checkpoint, before);
  assert.equal((await resume()).scannedPages, 1);
});

test("preparation cannot register retained roots after publication authorization is denied", async (t) => {
  const { store, sessionDir, options } = await fixture(t);
  const denied = new Error("retention authorization denied");
  let planId;
  await assert.rejects(
    prepareSessionArtifactCleanup({
      ...options,
      dryRun: false,
      assertSessionWritable: async ({ operation }) => {
        if (operation === "publish_session_artifact_cleanup") throw denied;
      },
    }),
    (error) => {
      assert.equal(error.cause, denied);
      planId = error.planId;
      return true;
    },
  );
  const directory = path.join(sessionDir, PLAN.directory, planId);
  await assert.rejects(readFile(path.join(directory, PLAN.preparation)), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(directory, PLAN.manifest)), { code: "ENOENT" });
  assert.deepEqual(await readImmutableReaderRetentions(store, await store.snapshot()), []);
  const resumed = await prepareSessionArtifactCleanupToCompletion({
    ...options,
    dryRun: false,
    planId,
  });
  assert.equal(resumed.planId, planId);
  assert.equal(resumed.complete, true);
});

test("published preparation recovers a failed ownership release without republishing the plan", async (t) => {
  const { store, sessionDir, options, prepared } = await startPagedPreparation(t);
  const directory = path.join(sessionDir, PLAN.directory, prepared.planId);
  let publications = 0;
  await assert.rejects(
    prepareSessionArtifactCleanup({
      ...options,
      planId: prepared.planId,
      dryRun: false,
      maxMarkingPages: PLAN.maxMarkingPages,
      assertSessionWritable: async ({ operation }) => {
        if (operation === "publish_session_artifact_cleanup" && ++publications === 2)
          throw new Error("release authorization failed");
      },
    }),
    /release authorization failed/,
  );
  const manifest = await readFile(path.join(directory, PLAN.manifest));
  const progress = await readFile(path.join(directory, PLAN.progress));
  assert.ok((await readImmutableReaderRetentions(store, await store.snapshot())).length > 0);
  assert.equal(
    (
      await prepareSessionArtifactCleanup({
        ...options,
        planId: prepared.planId,
        dryRun: false,
        maxMarkingPages: 1,
      })
    ).complete,
    true,
  );
  assert.deepEqual(await readFile(path.join(directory, PLAN.manifest)), manifest);
  assert.deepEqual(await readFile(path.join(directory, PLAN.progress)), progress);
  assert.deepEqual(await readImmutableReaderRetentions(store, await store.snapshot()), []);
});

test("concurrent preparation resumption advances one serialized checkpoint and tolerates completion", async (t) => {
  const { sessionDir, options, prepared } = await startPagedPreparation(t);
  const directory = path.join(sessionDir, PLAN.directory, prepared.planId);
  const request = { ...options, planId: prepared.planId, dryRun: false, maxMarkingPages: 1 };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const results = await Promise.all([
      prepareSessionArtifactCleanup(request),
      prepareSessionArtifactCleanup(request),
    ]);
    if (results.every(({ complete }) => complete)) {
      assert.deepEqual(results[0], results[1]);
      await assert.rejects(readFile(path.join(directory, PLAN.preparation)), { code: "ENOENT" });
      return;
    }
  }
  assert.fail("concurrent preparation did not finish");
});
