/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { appendFile, readFile, readdir, rename, stat, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import {
  bindImmutableMigrationSource,
  IMMUTABLE_READER_RETENTION,
} from "@noobot/session-protocol/immutable-storage";
import {
  decodePartitionMigrationAuthority,
  PARTITION_MIGRATION_AUTHORITY,
  PARTITION_MIGRATION_BUSINESS_CHECKPOINT,
  decodePartitionMigrationBusinessCheckpoint,
} from "@noobot/session-protocol/session-reader";
import {
  IMMUTABLE_SEGMENT,
  immutableSegmentFileName,
} from "@noobot/session-protocol/immutable-segment";
import { resolveSessionArtifactMutationLock } from "../src/session/session-artifact-files.js";
import { readJournalHead } from "../src/session/partition-storage/journal-io.js";
import { PartitionJournalOwner } from "../src/session/partition-storage/partition-journal-owner.js";
import { createPartitionSessionReaderAccess } from "../src/session/partition-storage/partition-reader-access.js";
import {
  partitionMigrationAuthorityPath,
  partitionMigrationRoot,
  readImmutableAuthority,
  readPartitionStorageRoot,
} from "../src/session/session-storage-authority.js";
import { sessionMutationCoordinator } from "../src/session/session-mutation-coordinator.js";
import { auditImmutableSession } from "../src/session/session-artifact-session/immutable-session-audit.js";
import {
  cleanupSessionArtifacts,
  discardSessionArtifactCleanup,
} from "../src/session/session-artifact-maintenance.js";
import { withStorageCleanup } from "../src/shared/storage/durable-file.js";
import { getFsAdapter, setFsAdapter } from "../src/shared/storage/fs-adapter.js";
import { withIsolatedImmutableMigrationSource } from "../src/workspace-lifecycle/with-isolated-immutable-migration-source.js";
import { reconcileImmutableSessionStaging } from "../src/workspace-lifecycle/reconcile-immutable-session-staging.js";
import { readSessionDirectory } from "../src/workspace-lifecycle/session-directory-walk.js";
import { migrateImmutableSessionToPartition } from "../src/workspace-lifecycle/migrate-immutable-session-to-partition.js";
import { publishImmutableSessionStaging } from "../src/workspace-lifecycle/publish-immutable-session-staging.js";
import { withImmutableSessionMigrationSource } from "../src/workspace-lifecycle/immutable-session-migration-source.js";
import { createTransactionCase, journalTestLimits } from "./helpers/partition-journal-cases.js";
import { prepareSessionArtifactCleanupToCompletion } from "./helpers/immutable-cleanup.js";
import { TEST_STORAGE_SERVICE as storageService } from "./helpers/storage-service.js";

import {
  createIsolatedMigrationFixture,
  runColdMigrationProcess,
} from "./workspace-isolated-immutable-migration.test-helpers.js";

const directorySyncTest = {
  skip: process.platform === "win32" && "Windows storage does not open directory handles for sync",
};

async function contendDuringCapture(t, options, sourceFile, contend, whileQueued, verify) {
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const queued = Promise.withResolvers();
  const adapter = getFsAdapter();
  setFsAdapter({
    ...adapter,
    async lstat(file, ...args) {
      if (file === sourceFile) {
        entered.resolve();
        await resume.promise;
      }
      return adapter.lstat(file, ...args);
    },
  });
  let operation;
  const capture = withIsolatedImmutableMigrationSource(options, async (replica) => {
    await verify(replica, await operation);
  });
  try {
    await Promise.race([entered.promise, capture]);
    const lock = resolveSessionArtifactMutationLock(options.sessionDir);
    const owner = sessionMutationCoordinator.localQueues.get(lock);
    assert.ok(owner, "capture owns the source mutation queue");
    const waitForLocalTurn = sessionMutationCoordinator.waitForLocalTurn;
    t.mock.method(sessionMutationCoordinator, "waitForLocalTurn", function (previous, deadline) {
      if (previous === owner) queued.resolve();
      return waitForLocalTurn.call(this, previous, deadline);
    });
    operation = contend();
    await Promise.race([
      queued.promise,
      operation.then(() => assert.fail("mutation completed without waiting for the capture")),
    ]);
    await whileQueued();
  } finally {
    resume.resolve();
    setFsAdapter(adapter);
    await Promise.all([capture, operation]);
  }
  assert.deepEqual(await readdir(options.scratchRoot), []);
}

async function verifyReconciliation(replica, head, root) {
  const report = await reconcileImmutableSessionStaging({
    sessionDir: replica.sessionDir,
    stagingDir: root,
    expectedSource: replica.identity,
    targetStorageBudget: { journalLimits: journalTestLimits(), maxJournals: 1 },
    limit: 2,
    maxBytes: 4096,
  });
  assert.deepEqual(report.source, bindImmutableMigrationSource(head, null));
  assert.equal(report.messageCount, 3);
  assert.equal(report.receiptCount, head.generation);
}

test("isolated migration captures a committed tail before the queued writer truncates and appends", async (t) => {
  const { options, store, head, tail, sourceTail } = await createIsolatedMigrationFixture(t);
  const { journal, root } = await createTransactionCase(t, {}, { sessionId: head.sessionId });
  await journal.close();
  const uncommitted = Buffer.from("uncommitted bytes");
  await appendFile(sourceTail, uncommitted);
  await contendDuringCapture(
    t,
    options,
    sourceTail,
    () =>
      store.commit({
        expectedGeneration: head.generation,
        operationId: "advance-captured-source",
        changes: [{ collection: "metadata", key: "capture-test", value: true }],
      }),
    async () => {
      assert.equal((await store.snapshot()).generation, head.generation);
      assert.deepEqual((await readFile(sourceTail)).subarray(head.segmentTail.end), uncommitted);
    },
    async (replica) => {
      const advanced = await store.snapshot();
      assert.equal(advanced.generation, head.generation + 1);
      assert.equal(advanced.segmentTail.segmentId, head.segmentTail.segmentId);
      const tailCopy = join(replica.sessionDir, IMMUTABLE_SEGMENT.directory, tail);
      const copied = await readFile(tailCopy);
      const appended = await readFile(sourceTail);
      assert.equal(copied.length, head.segmentTail.end);
      assert.equal(appended.length, advanced.segmentTail.end);
      assert.deepEqual(appended.subarray(0, copied.length), copied);
      assert.equal(appended.includes(uncommitted, copied.length), false);
      assert.notEqual((await stat(tailCopy)).ino, (await stat(sourceTail)).ino);
      assert.equal(replica.audit.checkedCommits, head.generation);
      await verifyReconciliation(replica, head, root);
    },
  );
  await assert.rejects(withIsolatedImmutableMigrationSource(options, assert.fail), {
    code: "SESSION_MIGRATION_SOURCE_CHANGED",
  });
  assert.deepEqual(await readdir(options.scratchRoot), []);
});

async function prepareOrphanCleanup(sessionDir) {
  const name = immutableSegmentFileName(randomUUID().replaceAll("-", ""));
  const orphan = join(sessionDir, IMMUTABLE_SEGMENT.directory, name);
  await writeFile(orphan, IMMUTABLE_SEGMENT.magic, { flag: "wx" });
  const maintenance = {
    storageService,
    sessionDir,
    assertSessionWritable: async () => {},
  };
  const { planId, candidates } = await prepareSessionArtifactCleanupToCompletion({
    ...maintenance,
    dryRun: false,
  });
  return { maintenance, planId, candidates, orphan, name };
}

test("isolated migration survives maintenance reclaiming a captured source segment", async (t) => {
  const { options, head } = await createIsolatedMigrationFixture(t);
  const { journal, root } = await createTransactionCase(t, {}, { sessionId: head.sessionId });
  await journal.close();
  const { maintenance, planId, candidates, orphan, name } = await prepareOrphanCleanup(
    options.sessionDir,
  );
  const cleanup = { ...maintenance, planId, maxCandidates: 1, maxRemovals: 1 };
  try {
    assert.equal(candidates, 1);
    await contendDuringCapture(
      t,
      options,
      orphan,
      () => cleanupSessionArtifacts(cleanup),
      async () => assert.equal(await readFile(orphan, "utf8"), IMMUTABLE_SEGMENT.magic),
      async (replica, result) => {
        assert.equal(result.complete, true);
        await assert.rejects(stat(orphan), { code: "ENOENT" });
        const copied = join(replica.sessionDir, IMMUTABLE_SEGMENT.directory, name);
        assert.equal(await readFile(copied, "utf8"), IMMUTABLE_SEGMENT.magic);
        const audit = await auditImmutableSession({ sessionDir: replica.sessionDir });
        assert.equal(audit.ok, true, JSON.stringify(audit.issues));
        assert.equal(audit.complete, true);
        assert.equal(audit.checkedCommits, head.generation);
        await verifyReconciliation(replica, head, root);
      },
    );
  } finally {
    await discardSessionArtifactCleanup({ ...maintenance, planId });
  }
});

test("isolated migration rejects a truncated source and cleans scratch before returning", async (t) => {
  const { options, head, sourceTail } = await createIsolatedMigrationFixture(t);
  await truncate(sourceTail, head.segmentTail.end - 1);
  await assert.rejects(withIsolatedImmutableMigrationSource(options, assert.fail), {
    message: "Migration source committed tail is truncated",
  });
  assert.deepEqual(await readdir(options.scratchRoot), []);
});

async function preparedPublication(t) {
  const {
    options: { sessionDir, expectedSource },
    store,
    head,
  } = await createIsolatedMigrationFixture(t);
  const { journal, root } = await createTransactionCase(t, {}, { sessionId: head.sessionId });
  await journal.close();
  const options = {
    sessionDir,
    expectedSource,
    targetStorageBudget: { journalLimits: journalTestLimits(), maxJournals: 1 },
    limit: 2,
    maxBytes: 4096,
  };
  await reconcileImmutableSessionStaging({ ...options, stagingDir: root });
  const target = partitionMigrationRoot(sessionDir);
  await rename(root, target);
  return { options, store, head, target, marker: partitionMigrationAuthorityPath(sessionDir) };
}

test("offline migration retries publication without replacing the verified journal", async (t) => {
  const { options: source } = await createIsolatedMigrationFixture(t);
  const { sessionDir } = source;
  const options = {
    sessionDir,
    expectedSource: source.expectedSource,
    targetStorageBudget: { journalLimits: journalTestLimits(), maxJournals: 1 },
    limit: 2,
    maxBytes: 4096,
  };
  const marker = partitionMigrationAuthorityPath(sessionDir);
  const target = partitionMigrationRoot(sessionDir);
  const fault = new Error("authority publication failed");
  const adapter = getFsAdapter();
  setFsAdapter({
    ...adapter,
    async rename(from, to) {
      if (to === marker) throw fault;
      return adapter.rename(from, to);
    },
  });
  try {
    await assert.rejects(migrateImmutableSessionToPartition(options), fault);
  } finally {
    setFsAdapter(adapter);
  }
  await assert.rejects(readPartitionStorageRoot(sessionDir), {
    code: "SESSION_PARTITION_STORAGE_UPGRADE_REQUIRED",
  });
  await assert.rejects(stat(marker), { code: "ENOENT" });
  await readImmutableAuthority(sessionDir);
  const staged = await stat(target);
  const receipt = await migrateImmutableSessionToPartition(options);
  assert.deepEqual(receipt.source, source.expectedSource);
  assert.equal(await readPartitionStorageRoot(sessionDir), target);
  assert.equal((await stat(target)).ino, staged.ino);
  assert.deepEqual(await migrateImmutableSessionToPartition(options), receipt);
});

for (const exitPoint of ["business", "receipts", "before-rename"]) {
  test(`offline migration resumes without leaked source readers after process exit: ${exitPoint}`, async (t) => {
    const { options: source } = await createIsolatedMigrationFixture(t);
    const { sessionDir } = source;
    const options = {
      sessionDir,
      expectedSource: source.expectedSource,
      targetStorageBudget: { journalLimits: journalTestLimits(), maxJournals: 1 },
      limit: 2,
      maxBytes: 4096,
    };
    const moduleUrl = (file) => JSON.stringify(new URL(file, import.meta.url).href);
    const target = partitionMigrationRoot(sessionDir);
    const scratch = `${sessionDir}${PARTITION_MIGRATION_AUTHORITY.scratchSuffix}`;
    const checkpointFile = join(scratch, PARTITION_MIGRATION_BUSINESS_CHECKPOINT.file);
    const readers = join(sessionDir, IMMUTABLE_READER_RETENTION.directory);
    await assert.rejects(stat(readers), { code: "ENOENT" });
    await assert.rejects(
      runColdMigrationProcess(
        `
      import { existsSync } from "node:fs";
      import { getFsAdapter, setFsAdapter } from ${moduleUrl("../src/shared/storage/fs-adapter.js")};
      import { migrateImmutableSessionToPartition } from ${moduleUrl("../src/workspace-lifecycle/migrate-immutable-session-to-partition.js")};
      import { PartitionJournal } from ${moduleUrl("../src/session/partition-storage/partition-journal.js")};
      const { options, target, checkpointFile, exitPoint } = JSON.parse(process.argv[1]);
      const append = PartitionJournal.prototype.appendTransaction;
      PartitionJournal.prototype.appendTransaction = async function (...args) {
        const result = await append.apply(this, args);
        if (exitPoint === "business" || (exitPoint === "receipts" && existsSync(checkpointFile)))
          process.exit(71);
        return result;
      };
      const adapter = getFsAdapter();
      setFsAdapter({
        ...adapter,
        async rename(from, to) {
          if (to === target) process.exit(71);
          return adapter.rename(from, to);
        },
      });
      await migrateImmutableSessionToPartition(options);
    `,
        { options, target, checkpointFile, exitPoint },
      ),
      { code: 71 },
    );
    assert.ok((await stat(scratch)).isDirectory());
    await assert.rejects(stat(target), { code: "ENOENT" });
    await assert.rejects(stat(readers), { code: "ENOENT" });
    await readImmutableAuthority(sessionDir);
    const { children } = await readSessionDirectory(join(sessionDir, ".."));
    assert.ok(
      !children.some(({ name }) => name.endsWith(PARTITION_MIGRATION_AUTHORITY.scratchSuffix)),
    );
    const stagedHead = await readJournalHead(join(scratch, "journal"), { readBytes: 0 });
    let checkpoint;
    if (exitPoint === "business") {
      await assert.rejects(stat(checkpointFile), { code: "ENOENT" });
    } else {
      const bytes = await readFile(checkpointFile);
      checkpoint = decodePartitionMigrationBusinessCheckpoint(bytes);
      assert.deepEqual(checkpoint.source, options.expectedSource);
      assert.equal(checkpoint.target.epoch, stagedHead.epoch);
      const imported = exitPoint === "receipts" ? 1 : options.expectedSource.generation;
      assert.equal(stagedHead.sequence, checkpoint.target.generation + imported);
      await writeFile(checkpointFile, "invalid checkpoint");
      await assert.rejects(migrateImmutableSessionToPartition(options), {
        code: "SESSION_STORAGE_CORRUPT",
      });
      assert.deepEqual(
        await readJournalHead(join(scratch, "journal"), { readBytes: 0 }),
        stagedHead,
      );
      await writeFile(checkpointFile, bytes);
    }
    const receipt = await migrateImmutableSessionToPartition(options);
    if (checkpoint) {
      assert.equal(receipt.target.epoch, stagedHead.epoch);
      assert.equal(
        receipt.target.generation,
        checkpoint.target.generation + receipt.source.generation,
      );
    } else {
      assert.notEqual(receipt.target.epoch, stagedHead.epoch);
    }
    await assert.rejects(stat(scratch), { code: "ENOENT" });
    await assert.rejects(stat(readers), { code: "ENOENT" });
    assert.equal(await readPartitionStorageRoot(sessionDir), target);
    assert.deepEqual(await migrateImmutableSessionToPartition(options), receipt);
  });
}

test("migration publication refuses retained readers until their registrations are released", async (t) => {
  const { options, store, head, marker, target } = await preparedPublication(t);
  const { sessionDir } = options;
  const retentions = join(sessionDir, IMMUTABLE_READER_RETENTION.directory);
  await withImmutableSessionMigrationSource(options, async (source) => {
    await assert.rejects(publishImmutableSessionStaging(options), {
      code: "SESSION_STORAGE_MIGRATION_READERS_ACTIVE",
    });
    await assert.rejects(stat(marker), { code: "ENOENT" });
    await assert.rejects(readPartitionStorageRoot(sessionDir), {
      code: "SESSION_PARTITION_STORAGE_UPGRADE_REQUIRED",
    });
    assert.equal((await source.readMetadata()).sessionId, head.sessionId);
    assert.equal((await readdir(retentions)).length, 1);
  });
  assert.deepEqual(await readdir(retentions), []);
  await publishImmutableSessionStaging(options);
  assert.equal(await readPartitionStorageRoot(sessionDir), target);
  assert.deepEqual(await store.snapshot(), head);
  assert.deepEqual(await readdir(retentions), []);
});

test("migration publication refuses retained cleanup plans until they are discarded", async (t) => {
  const { options, store, head, marker, target } = await preparedPublication(t);
  const { sessionDir } = options;
  const { maintenance, planId, candidates, orphan } = await prepareOrphanCleanup(sessionDir);
  await withStorageCleanup(
    async () => {
      assert.equal(candidates, 1);
      await assert.rejects(publishImmutableSessionStaging(options), {
        code: "SESSION_STORAGE_MIGRATION_READERS_ACTIVE",
      });
      await assert.rejects(stat(marker), { code: "ENOENT" });
      await assert.rejects(readPartitionStorageRoot(sessionDir), {
        code: "SESSION_PARTITION_STORAGE_UPGRADE_REQUIRED",
      });
      assert.deepEqual(await store.snapshot(), head);
      assert.equal(await readFile(orphan, "utf8"), IMMUTABLE_SEGMENT.magic);
      const result = await cleanupSessionArtifacts({
        ...maintenance,
        planId,
        maxCandidates: 1,
        maxRemovals: 1,
      });
      assert.equal(result.complete, true);
      await assert.rejects(stat(orphan), { code: "ENOENT" });
      await assert.rejects(publishImmutableSessionStaging(options), {
        code: "SESSION_STORAGE_MIGRATION_READERS_ACTIVE",
      });
      await assert.rejects(stat(marker), { code: "ENOENT" });
    },
    () => discardSessionArtifactCleanup({ ...maintenance, planId }),
  );
  await publishImmutableSessionStaging(options);
  assert.equal(await readPartitionStorageRoot(sessionDir), target);
  assert.deepEqual(await store.snapshot(), head);
});

test("migration publication fences a queued legacy commit", async (t) => {
  const { options, store, head, marker, target } = await preparedPublication(t);
  const { sessionDir } = options;
  const adapter = getFsAdapter();
  const entered = Promise.withResolvers();
  const proceed = Promise.withResolvers();
  const queued = Promise.withResolvers();
  setFsAdapter({
    ...adapter,
    async rename(from, to) {
      if (to === marker) {
        entered.resolve();
        await proceed.promise;
      }
      return adapter.rename(from, to);
    },
  });
  const publication = publishImmutableSessionStaging(options);
  let rejection;
  try {
    await Promise.race([entered.promise, publication]);
    const owner = sessionMutationCoordinator.localQueues.get(store.lockPath);
    assert.ok(owner);
    const wait = sessionMutationCoordinator.waitForLocalTurn;
    t.mock.method(sessionMutationCoordinator, "waitForLocalTurn", function (previous, deadline) {
      if (previous === owner) queued.resolve();
      return wait.call(this, previous, deadline);
    });
    rejection = assert.rejects(
      store.commit({
        expectedGeneration: head.generation,
        operationId: "queued-after-migration",
        changes: [{ collection: "metadata", key: "queued-after-migration", value: true }],
      }),
      { code: "SESSION_STORAGE_AUTHORITY_MISMATCH" },
    );
    void rejection.catch(() => {});
    await Promise.race([
      queued.promise,
      rejection.then(() => assert.fail("writer was not queued")),
    ]);
  } finally {
    proceed.resolve();
    try {
      await Promise.all([publication, rejection]);
    } finally {
      setFsAdapter(adapter);
    }
  }
  assert.equal(await readPartitionStorageRoot(sessionDir), target);
  assert.deepEqual(await store.snapshot(), head);
  await assert.rejects(stat(join(sessionDir, IMMUTABLE_READER_RETENTION.directory)), {
    code: "ENOENT",
  });
});

test("failed migration authority rename leaves the legacy source authoritative and permits retry", async (t) => {
  const { options, marker, target } = await preparedPublication(t);
  const adapter = getFsAdapter();
  const fault = Object.assign(new Error("injected authority rename failure"), { code: "EIO" });
  setFsAdapter({
    ...adapter,
    async rename(from, to) {
      if (to === marker) throw fault;
      return adapter.rename(from, to);
    },
  });
  try {
    await assert.rejects(publishImmutableSessionStaging(options), fault);
  } finally {
    setFsAdapter(adapter);
  }
  await assert.rejects(stat(marker), { code: "ENOENT" });
  await assert.rejects(readPartitionStorageRoot(options.sessionDir), {
    code: "SESSION_PARTITION_STORAGE_UPGRADE_REQUIRED",
  });
  await readImmutableAuthority(options.sessionDir);
  const report = await publishImmutableSessionStaging(options);
  const authority = decodePartitionMigrationAuthority(await readFile(marker));
  assert.deepEqual(authority.source, report.source);
  assert.deepEqual(authority.target, report.target);
  assert.equal(await readPartitionStorageRoot(options.sessionDir), target);
});

for (const publicationPoint of ["before", "after"]) {
  test(`fresh process selects one authority after termination ${publicationPoint} migration rename`, async (t) => {
    const { options, marker, head, target } = await preparedPublication(t);
    const moduleUrl = (file) => JSON.stringify(new URL(file, import.meta.url).href);
    const publisher = runColdMigrationProcess(
      `
      import { getFsAdapter, setFsAdapter } from ${moduleUrl("../src/shared/storage/fs-adapter.js")};
      import { publishImmutableSessionStaging } from ${moduleUrl("../src/workspace-lifecycle/publish-immutable-session-staging.js")};
      const { options, marker, publicationPoint } = JSON.parse(process.argv[1]);
      const adapter = getFsAdapter();
      async function pauseAtRename() {
        process.stdin.resume();
        process.stdout.write("selector rename reached\\n");
        await new Promise(() => {});
      }
      setFsAdapter({
        ...adapter,
        async rename(from, to) {
          if (to === marker && publicationPoint === "before") await pauseAtRename();
          await adapter.rename(from, to);
          if (to === marker && publicationPoint === "after") await pauseAtRename();
        },
      });
      await publishImmutableSessionStaging(options);
    `,
      { options, marker, publicationPoint },
    );
    const { child } = publisher;
    using lines = createInterface({ input: child.stdout });
    try {
      const [line] = await Promise.race([
        once(lines, "line"),
        publisher.then(() => assert.fail("publisher exited before reaching selector rename")),
      ]);
      assert.equal(line, "selector rename reached");
      assert.equal(child.kill("SIGKILL"), true);
      await assert.rejects(publisher, (error) => {
        assert.equal(error.signal, "SIGKILL", error.stderr);
        return true;
      });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await Promise.allSettled([publisher]);
    }

    const { sessionDir } = options;
    await runColdMigrationProcess(
      `
      import assert from "node:assert/strict";
      import { dirname } from "node:path";
      import { readImmutableAuthority, readPartitionStorageRoot } from ${moduleUrl("../src/session/session-storage-authority.js")};
      import { PartitionJournalOwner } from ${moduleUrl("../src/session/partition-storage/partition-journal-owner.js")};
      import { createPartitionSessionReaderAccess } from ${moduleUrl("../src/session/partition-storage/partition-reader-access.js")};
      const { sessionDir, sessionId, target, publicationPoint } = JSON.parse(process.argv[1]);
      if (publicationPoint === "before") {
        await readImmutableAuthority(sessionDir);
        await assert.rejects(readPartitionStorageRoot(sessionDir), {
          code: "SESSION_PARTITION_STORAGE_UPGRADE_REQUIRED",
        });
      } else {
        await assert.rejects(readImmutableAuthority(sessionDir), {
          code: "SESSION_STORAGE_AUTHORITY_MISMATCH",
        });
        assert.equal(await readPartitionStorageRoot(sessionDir), target);
        await using owner = new PartitionJournalOwner({
          durableAncestor: dirname(sessionDir), maxJournals: 1, allowNewJournals: false,
        });
        const access = createPartitionSessionReaderAccess({
          acquireJournal: owner.acquire.bind(owner),
          withJournalRemoval: owner.withRemoval.bind(owner),
        });
        await using reader = await access.openArtifact({ sessionDir });
        assert.equal((await reader.readMetadata()).sessionId, sessionId);
      }
    `,
      { sessionDir, sessionId: head.sessionId, target, publicationPoint },
    );
    if (publicationPoint === "before") {
      await publishImmutableSessionStaging(options);
      assert.equal(await readPartitionStorageRoot(sessionDir), target);
    }
  });
}

test(
  "staging directory sync failure leaves the legacy authority active",
  directorySyncTest,
  async (t) => {
    const { options, marker, target } = await preparedPublication(t);
    const adapter = getFsAdapter();
    const fault = Object.assign(new Error("injected staging entry sync failure"), { code: "EIO" });
    setFsAdapter({
      ...adapter,
      async open(file, flags, ...args) {
        const handle = await adapter.open(file, flags, ...args);
        if (file !== options.sessionDir || flags !== "r") return handle;
        return {
          async sync() {
            throw fault;
          },
          close: () => handle.close(),
        };
      },
    });
    try {
      await assert.rejects(publishImmutableSessionStaging(options), fault);
    } finally {
      setFsAdapter(adapter);
    }
    await assert.rejects(stat(marker), { code: "ENOENT" });
    await readImmutableAuthority(options.sessionDir);
    await publishImmutableSessionStaging(options);
    assert.equal(await readPartitionStorageRoot(options.sessionDir), target);
  },
);

test("cold access rejects a missing or replaced migration target without reactivating legacy storage", async (t) => {
  const { options, head, target } = await preparedPublication(t);
  await publishImmutableSessionStaging(options);
  const { sessionDir } = options;
  await rename(target, `${target}.retained`);

  async function assertNoReadableAuthority(message) {
    await using owner = new PartitionJournalOwner({
      durableAncestor: join(sessionDir, ".."),
      maxJournals: 1,
      allowNewJournals: false,
    });
    const access = createPartitionSessionReaderAccess({
      acquireJournal: owner.acquire.bind(owner),
      withJournalRemoval: owner.withRemoval.bind(owner),
    });
    await assert.rejects(access.openArtifact({ sessionDir }), {
      code: "SESSION_STORAGE_CORRUPT",
      message,
    });
    await assert.rejects(readImmutableAuthority(sessionDir), {
      code: "SESSION_STORAGE_AUTHORITY_MISMATCH",
    });
  }

  await assertNoReadableAuthority("Published migration target is missing");
  const { journal, root } = await createTransactionCase(t, {}, { sessionId: head.sessionId });
  await journal.close();
  await rename(root, target);
  await assertNoReadableAuthority("Journal does not match the published migration target");
});

test(
  "migration authority directory sync failure does not redirect readers to the legacy source",
  directorySyncTest,
  async (t) => {
    const { options, marker, head, target } = await preparedPublication(t);
    const adapter = getFsAdapter();
    const fault = Object.assign(new Error("injected authority directory sync failure"), {
      code: "EIO",
    });
    let renamed = false;
    let injected = false;
    setFsAdapter({
      ...adapter,
      async rename(from, to) {
        await adapter.rename(from, to);
        if (to === marker) renamed = true;
      },
      async open(file, flags, ...args) {
        const handle = await adapter.open(file, flags, ...args);
        if (!renamed || injected || file !== options.sessionDir || flags !== "r") return handle;
        injected = true;
        return {
          sync: async () => {
            throw fault;
          },
          close: () => handle.close(),
        };
      },
    });
    try {
      await assert.rejects(publishImmutableSessionStaging(options), {
        code: "SESSION_MIGRATION_PUBLICATION_UNCERTAIN",
        cause: fault,
      });
    } finally {
      setFsAdapter(adapter);
    }
    assert.ok(injected);
    const selector = await readFile(marker);
    const { source, target: targetIdentity } = decodePartitionMigrationAuthority(selector);
    assert.equal(await readPartitionStorageRoot(options.sessionDir), target);
    const { sessionDir } = options;
    await using owner = new PartitionJournalOwner({
      durableAncestor: join(sessionDir, ".."),
      maxJournals: 1,
      allowNewJournals: false,
    });
    const access = createPartitionSessionReaderAccess({
      acquireJournal: owner.acquire.bind(owner),
      withJournalRemoval: owner.withRemoval.bind(owner),
    });
    let synced = false;
    setFsAdapter({
      ...adapter,
      async open(file, flags, ...args) {
        const handle = await adapter.open(file, flags, ...args);
        if (file !== sessionDir || flags !== "r") return handle;
        return {
          async sync() {
            await handle.sync();
            synced = true;
          },
          close: () => handle.close(),
        };
      },
    });
    try {
      await using reader = await access.openArtifact({ sessionDir });
      assert.ok(synced);
      assert.equal((await reader.readMetadata()).sessionId, head.sessionId);
    } finally {
      setFsAdapter(adapter);
    }
    await assert.rejects(
      publishImmutableSessionStaging({
        ...options,
        expectedSource: { ...source, generation: source.generation + 1 },
      }),
      { code: "SESSION_MIGRATION_SOURCE_CHANGED" },
    );
    const { ino } = await stat(marker);
    assert.deepEqual(await publishImmutableSessionStaging(options), {
      source,
      target: targetIdentity,
    });
    assert.equal((await stat(marker)).ino, ino);
    assert.deepEqual(await readFile(marker), selector);
  },
);

test("migration retry enforces target policy and confirms the original receipt after a commit", async (t) => {
  const { options, head, marker, target } = await preparedPublication(t);
  const { sessionDir, targetStorageBudget } = options;
  const mismatched = {
    ...options,
    targetStorageBudget: {
      ...targetStorageBudget,
      journalLimits: { ...targetStorageBudget.journalLimits, batchWaitMs: 2 },
    },
  };
  const policyMismatch = { code: "SESSION_STORAGE_POLICY_MISMATCH" };
  await assert.rejects(publishImmutableSessionStaging(mismatched), policyMismatch);
  const receipt = await publishImmutableSessionStaging(options);
  const selector = await readFile(marker);
  await assert.rejects(publishImmutableSessionStaging(mismatched), policyMismatch);

  await using owner = new PartitionJournalOwner({
    durableAncestor: join(sessionDir, ".."),
    maxJournals: 1,
    allowNewJournals: false,
  });
  const access = createPartitionSessionReaderAccess({
    acquireJournal: owner.acquire.bind(owner),
    withJournalRemoval: owner.withRemoval.bind(owner),
  });
  const placement = await access.readPlacement({ sessionDir, sessionId: head.sessionId });
  const title = "Updated after publication";
  await access.withMutation({ sessionDir, ...placement }, async (reader, commitChanges) => {
    await commitChanges(
      await reader.prepareRequest({
        operationId: "post-migration-title",
        committedAt: "2026-11-22T00:00:00.000Z",
        changes: { sessionMetadata: { customTitle: title } },
      }),
    );
  });
  await using reader = await access.openArtifact({ sessionDir });
  assert.ok(reader.generation > receipt.target.generation);
  assert.equal((await reader.readMetadata()).customTitle, title);
  assert.equal(await readPartitionStorageRoot(sessionDir), target);
  assert.deepEqual(await publishImmutableSessionStaging(options), receipt);
  assert.deepEqual(await readFile(marker), selector);
});
