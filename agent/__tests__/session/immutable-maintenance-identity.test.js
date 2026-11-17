/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import {
  auditImmutableSession,
  auditImmutableSnapshot,
} from "../../src/session/session-artifact-session/immutable-session-audit.js";
import {
  inspectSessionArtifacts,
  repairSessionArtifacts,
  prepareSessionArtifactCleanup,
  cleanupSessionArtifacts,
  discardSessionArtifactCleanup,
} from "../../src/session/session-artifact-maintenance.js";
import { TEST_STORAGE_SERVICE as storageService } from "../helpers/storage-service.js";
import { ImmutableObjectStore } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { buildImmutableCleanupPlan } from "../../src/session/session-artifact-session/immutable-cleanup-plan.js";
import { IMMUTABLE_CLEANUP_PLAN } from "@noobot/session-protocol/immutable-storage";

async function fixture(t, objectStore) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "maintenance-identity-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const store = new ImmutableSessionStore({
    sessionDir,
    sessionId: "owner",
    allowCreate: true,
    objectStore,
  });
  await store.commit({
    expectedGeneration: 0,
    operationId: "seed",
    changes: [{ collection: "metadata", key: "session", value: { sessionId: "owner" } }],
  });
  return { store, sessionDir, snapshot: await store.snapshot() };
}

test("snapshot audit rejects foreign and malformed heads before graph reads", async (t) => {
  const { store, snapshot } = await fixture(t);
  for (const invalid of [
    { ...snapshot, sessionId: "foreign" },
    { ...snapshot, unexpected: true },
    { ...snapshot, generation: 0 },
  ]) {
    const report = await auditImmutableSnapshot({ store, snapshot: invalid });
    assert.equal(report.ok, false);
    assert.equal(report.objectReads, 0);
    assert.equal(report.issues[0].code, "SESSION_IMMUTABLE_STORAGE_INVALID");
  }
  assert.equal((await auditImmutableSnapshot({ store, snapshot })).ok, true);
});

test("maintenance discovery preserves the caller's expected session identity", async (t) => {
  const { store, sessionDir } = await fixture(t);
  const head = await readFile(store.headPath);
  const entries = await readdir(sessionDir, { recursive: true });
  const options = {
    storageService,
    sessionDir,
    sessionId: "foreign",
    assertSessionWritable: async () => {},
  };
  const audit = await auditImmutableSession(options);
  assert.equal(audit.ok, false);
  const inspected = await inspectSessionArtifacts(options);
  assert.equal(inspected.ok, false);
  await assert.rejects(prepareSessionArtifactCleanup({ ...options, dryRun: false }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  await assert.rejects(repairSessionArtifacts({ ...options, alreadyLocked: false }), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  assert.deepEqual(await readFile(store.headPath), head);
  assert.deepEqual(await readdir(sessionDir, { recursive: true }), entries);
});

test("snapshot audit rejects foreign retained roots before graph reads", async (t) => {
  const { store, snapshot } = await fixture(t);
  const report = await auditImmutableSnapshot({
    store,
    snapshot,
    retainedSnapshots: [{ ...snapshot, sessionId: "foreign" }],
  });
  assert.equal(report.ok, false);
  assert.equal(report.objectReads, 0);
  assert.equal(report.issues[0].code, "SESSION_IMMUTABLE_STORAGE_INVALID");
});

test("repair rejects a foreign caller even with valid committed bytes", async (t) => {
  const { store, sessionDir, snapshot } = await fixture(t);
  const reference = await store.objects.withSnapshot(snapshot, async () => {
    const root = await store.index.get(snapshot.root, "metadata");
    return store.index.get(root, "session");
  });
  const bytes = await store.objects.withSnapshot(snapshot, () => store.objects.read(reference));
  const head = await readFile(store.headPath);
  const entries = await readdir(sessionDir, { recursive: true });
  await assert.rejects(
    repairSessionArtifacts({
      storageService,
      sessionDir,
      sessionId: "foreign",
      alreadyLocked: false,
      assertSessionWritable: async () => {},
      objectReplacements: [{ reference, bytes }],
    }),
    { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
  );
  assert.deepEqual(await readFile(store.headPath), head);
  assert.deepEqual(await readdir(sessionDir, { recursive: true }), entries);
  assert.deepEqual(
    await store.objects.withSnapshot(snapshot, () => store.objects.read(reference)),
    bytes,
  );
});

test("cleanup apply and discard reject a foreign caller without changing the plan", async (t) => {
  const { store, sessionDir } = await fixture(t);
  const options = {
    storageService,
    sessionDir,
    sessionId: "owner",
    assertSessionWritable: async () => {},
  };
  const plan = await prepareSessionArtifactCleanup({ ...options, dryRun: false });
  const head = await readFile(store.headPath);
  const entries = await readdir(sessionDir, { recursive: true });
  for (const operation of [cleanupSessionArtifacts, discardSessionArtifactCleanup]) {
    await assert.rejects(operation({ ...options, sessionId: "foreign", planId: plan.planId }), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
    assert.deepEqual(await readFile(store.headPath), head);
    assert.deepEqual(await readdir(sessionDir, { recursive: true }), entries);
  }
  assert.equal((await cleanupSessionArtifacts({ ...options, planId: plan.planId })).complete, true);
  assert.equal(
    (await discardSessionArtifactCleanup({ ...options, planId: plan.planId })).discarded,
    true,
  );
  assert.equal(
    (await discardSessionArtifactCleanup({ ...options, planId: plan.planId })).discarded,
    true,
  );
});

for (const objectStore of [undefined]) {
  test(`preparation preserves its own scratch after head failure (${objectStore?.format ?? "current"})`, async (t) => {
    const { store, sessionDir } = await fixture(t, objectStore);
    const failure = new Error("preparation publication failed");
    let planId;
    await assert.rejects(
      buildImmutableCleanupPlan({
        sessionDir,
        sessionId: "owner",
        objectStore,
        dryRun: false,
        publish: async () => {
          await writeFile(store.headPath, "damaged head");
          throw failure;
        },
      }),
      (error) => {
        assert.equal(error.code, "SESSION_MAINTENANCE_PREPARATION_INTERRUPTED");
        assert.equal(error.cause, failure);
        planId = error.planId;
        return true;
      },
    );
    assert.deepEqual(await readdir(path.join(sessionDir, IMMUTABLE_CLEANUP_PLAN.directory)), [
      planId,
    ]);
    assert.equal(await readFile(store.headPath, "utf8"), "damaged head");
  });
}

test("cleanup rejects an unmigrated object session before allocating scratch", async (t) => {
  const { store, sessionDir } = await fixture(t, ImmutableObjectStore);
  const head = await readFile(store.headPath);
  const entries = await readdir(sessionDir, { recursive: true });
  let publications = 0;
  await assert.rejects(
    buildImmutableCleanupPlan({
      sessionDir,
      sessionId: "owner",
      objectStore: ImmutableObjectStore,
      dryRun: false,
      publish: async () => {
        publications += 1;
      },
    }),
    { code: "SESSION_MAINTENANCE_MIGRATION_REQUIRED" },
  );
  assert.equal(publications, 0);
  assert.deepEqual(await readFile(store.headPath), head);
  assert.deepEqual(await readdir(sessionDir, { recursive: true }), entries);
});
