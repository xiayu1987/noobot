/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  IMMUTABLE_SESSION_HEAD_FILE,
  IMMUTABLE_SESSION_FORMAT_FILE,
} from "@noobot/session-protocol/immutable-storage";
import { requirePartitionSessionAuthority } from "@noobot/session-protocol/session-reader";
import { SESSION_ARTIFACT_FILE_NAMES } from "../../src/session/session-artifact-files.js";
import { sessionMutationCoordinator } from "../../src/session/session-mutation-coordinator.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import {
  acquireImmutableReaderRetention,
  withImmutableAuditRetention,
} from "../../src/session/session-artifact-session/immutable-reader-retention.js";
import { publishImmutableSessionFormat } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { migrateImmutableSessionSegments } from "../../src/session/session-artifact-session/immutable-segment-migration.js";
import { migrateSessionImmutableStorage } from "../../src/workspace-lifecycle/session-immutable-storage-upgrade.js";
import {
  cleanupSessionArtifacts,
  discardSessionArtifactCleanup,
  prepareSessionArtifactCleanup,
  repairSessionArtifacts,
} from "../../src/session/session-artifact-maintenance.js";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionJournalOwner } from "../../src/session/partition-storage/partition-journal-owner.js";
import { createPartitionSessionReaderAccess } from "../../src/session/partition-storage/partition-reader-access.js";
import {
  immutableSessionReaderAccess,
  openSessionArtifactReader,
} from "../../src/session/index.js";
import { journalTestLimits } from "../helpers/partition-journal-cases.js";
import { TEST_STORAGE_SERVICE } from "../helpers/storage-service.js";

const oldAuthorityFiles = [
  IMMUTABLE_SESSION_HEAD_FILE,
  IMMUTABLE_SESSION_FORMAT_FILE,
  SESSION_ARTIFACT_FILE_NAMES.session,
];

async function fixture(context) {
  const workspace = await mkdtemp(join(tmpdir(), "partition-authority-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  const root = join(workspace, "session");
  await mkdir(root);
  const scope = { sessionDir: root, sessionId: "session", parentSessionId: "" };
  const options = {
    root,
    sessionId: scope.sessionId,
    durableAncestor: workspace,
    limits: journalTestLimits(),
    publication: "collections",
  };
  const owner = new PartitionJournalOwner({ ...options, maxJournals: 1 });
  context.after(() => owner.close());
  const access = createPartitionSessionReaderAccess({
    acquireJournal: owner.acquire.bind(owner),
    withJournalRemoval: owner.withRemoval.bind(owner),
  });
  return { root, scope, options, owner, access };
}

test("queued Immutable writers and retention admissions revalidate authority", async (context) => {
  const { root, scope, options } = await fixture(context);
  const store = new ImmutableSessionStore({
    sessionDir: root,
    sessionId: scope.sessionId,
    allowCreate: true,
  });
  const entered = Promise.withResolvers();
  const publish = Promise.withResolvers();
  const partition = sessionMutationCoordinator.run(store.lockPath, async () => {
    entered.resolve();
    await publish.promise;
    const journal = await PartitionJournal.create(options);
    await journal.close();
    return { current: await readFile(join(root, "CURRENT")), entries: await readdir(root) };
  });
  await entered.promise;
  let rejections;
  try {
    const request = { expectedGeneration: 0, operationId: "queued-immutable" };
    const maintenance = {
      sessionDir: root,
      sessionId: scope.sessionId,
      storageService: TEST_STORAGE_SERVICE,
      assertSessionWritable: () => assert.fail("Obsolete maintenance must not reach writability"),
    };
    const planId = "6cd21195-1ec3-467b-9970-7dcc7c116552";
    rejections = Promise.all(
      [
        store.commit({ ...request, changes: [] }),
        store.transact({
          ...request,
          input: null,
          prepare: () => assert.fail("Obsolete transaction must not prepare changes"),
        }),
        publishImmutableSessionFormat(root),
        migrateImmutableSessionSegments({ sessionDir: root }),
        migrateSessionImmutableStorage(maintenance),
        repairSessionArtifacts(maintenance),
        prepareSessionArtifactCleanup({ ...maintenance, dryRun: false }),
        prepareSessionArtifactCleanup({ ...maintenance, planId, dryRun: false }),
        cleanupSessionArtifacts({ ...maintenance, planId }),
        discardSessionArtifactCleanup({ ...maintenance, planId }),
        acquireImmutableReaderRetention(store, () =>
          assert.fail("Obsolete reader reached validation"),
        ),
        withImmutableAuditRetention(store, undefined, () =>
          assert.fail("Obsolete audit acquired retention"),
        ),
      ].map((operation) =>
        assert.rejects(operation, { code: "SESSION_STORAGE_AUTHORITY_MISMATCH" }),
      ),
    );
    void rejections.catch(() => {});
  } finally {
    publish.resolve();
  }
  const [{ current, entries }] = await Promise.all([partition, rejections]);
  for (const file of oldAuthorityFiles)
    await assert.rejects(readFile(join(root, file)), { code: "ENOENT" });
  assert.deepEqual(await readFile(join(root, "CURRENT")), current);
  assert.deepEqual(await readdir(root), entries);
});

test("partition creation queued behind immutable initialization cannot publish a competing head", async (context) => {
  const { root, scope, options } = await fixture(context);
  const store = new ImmutableSessionStore({
    sessionDir: root,
    sessionId: scope.sessionId,
    allowCreate: true,
  });
  const entered = Promise.withResolvers();
  const publish = Promise.withResolvers();
  const queued = Promise.withResolvers();
  const immutable = sessionMutationCoordinator.run(store.lockPath, async () => {
    entered.resolve();
    await publish.promise;
    await store.commit({ expectedGeneration: 0, operationId: "initialize-immutable", changes: [] });
  });
  await entered.promise;
  const owner = sessionMutationCoordinator.localQueues.get(store.lockPath);
  const waitForLocalTurn = sessionMutationCoordinator.waitForLocalTurn;
  context.mock.method(
    sessionMutationCoordinator,
    "waitForLocalTurn",
    function (previous, deadline) {
      if (previous === owner) queued.resolve();
      return waitForLocalTurn.call(this, previous, deadline);
    },
  );
  const partition = assert.rejects(PartitionJournal.create(options), {
    code: "SESSION_PARTITION_STORAGE_UPGRADE_REQUIRED",
  });
  try {
    await Promise.race([
      queued.promise,
      partition.then(() => assert.fail("Partition creation must wait for the authority lock")),
    ]);
  } finally {
    publish.resolve();
    await Promise.all([immutable, partition]);
  }
  await assert.rejects(readFile(join(root, "CURRENT")), { code: "ENOENT" });
  assert.equal((await store.snapshot()).generation, 1);
});

test("partition authority protocol requires explicit facts and rejects competing authorities", () => {
  assert.equal(
    requirePartitionSessionAuthority({ partition: false, immutable: false, document: false }),
    false,
  );
  assert.equal(
    requirePartitionSessionAuthority({ partition: true, immutable: false, document: false }),
    true,
  );
  assert.throws(() => requirePartitionSessionAuthority({ partition: false }), TypeError);
  for (const partition of [false, true]) {
    for (const [immutable, document] of [
      [true, false],
      [false, true],
      [true, true],
    ]) {
      assert.throws(() => requirePartitionSessionAuthority({ partition, immutable, document }), {
        code: partition ? "SESSION_STORAGE_CORRUPT" : "SESSION_PARTITION_STORAGE_UPGRADE_REQUIRED",
      });
    }
  }
});

for (const file of oldAuthorityFiles) {
  test(`partition access rejects ${file} before opening a journal or changing files`, async (context) => {
    const { root, scope, options, access } = await fixture(context);
    const evidence = Buffer.from("old authority evidence");
    await writeFile(join(root, file), evidence);
    const before = await readdir(root);
    for (const operation of [
      () => access.readPlacement(scope),
      () => access.recover(scope),
      () => access.open(scope),
      () => access.withMutation(scope, () => assert.fail("Must not run mutation")),
      () => access.create(scope, { session: { sessionId: "session", parentSessionId: "" } }),
      () => PartitionJournal.create(options),
      () => PartitionJournal.open(options),
    ]) {
      await assert.rejects(operation(), { code: "SESSION_PARTITION_STORAGE_UPGRADE_REQUIRED" });
      assert.deepEqual(await readdir(root), before);
      assert.deepEqual(await readFile(join(root, file)), evidence);
    }
  });

  test(`mixed partition and ${file} authorities cannot be recovered or mutated`, async (context) => {
    const { root, scope, options, owner, access } = await fixture(context);
    const lease = await owner.acquire(scope, { create: true });
    await lease.release();
    const current = await readFile(join(root, "CURRENT"));
    await writeFile(join(root, file), "competing authority");
    const before = await readdir(root);
    for (const operation of [
      () => access.readPlacement(scope),
      () => access.recover(scope),
      () => access.open(scope),
      () => access.withMutation(scope, () => assert.fail("Must not run mutation")),
      () => access.create(scope, { session: { sessionId: "session", parentSessionId: "" } }),
      () => PartitionJournal.create(options),
      () => PartitionJournal.open(options),
      () => immutableSessionReaderAccess.readPlacement(scope),
      () => immutableSessionReaderAccess.recover(scope),
      () => immutableSessionReaderAccess.open(scope),
      () => immutableSessionReaderAccess.withMutation(scope, () => assert.fail("Must not mutate")),
      () =>
        immutableSessionReaderAccess.create(scope, {
          session: { sessionId: "session", parentSessionId: "" },
        }),
      () => openSessionArtifactReader(scope),
    ]) {
      await assert.rejects(operation(), { code: "SESSION_STORAGE_CORRUPT" });
      assert.deepEqual(await readdir(root), before);
      assert.deepEqual(await readFile(join(root, "CURRENT")), current);
      assert.equal(await readFile(join(root, file), "utf8"), "competing authority");
    }
  });
}

test("missing directories remain absent during placement discovery", async (context) => {
  const { root, scope } = await fixture(context);
  await rm(root, { recursive: true });
  const access = createPartitionSessionReaderAccess({
    acquireJournal: () => assert.fail("Missing sessions must not acquire an owner"),
    withJournalRemoval: () => assert.fail("Unexpected journal removal"),
  });
  assert.equal(await access.readPlacement(scope), null);
  assert.equal(await access.recover(scope), null);
  await assert.rejects(readdir(root), { code: "ENOENT" });
});
