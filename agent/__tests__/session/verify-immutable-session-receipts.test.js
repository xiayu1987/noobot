/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { prepareScopedSessionCommitRequest } from "@noobot/session-protocol/session-changes";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionSessionTransactions } from "../../src/session/partition-storage/partition-session-transactions.js";
import { openImmutableSessionReader } from "../../src/session/session-artifact-session/immutable-session-reader.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  commitFixtureTransaction,
  createJournalCase,
  createTransactionCase,
  journalTestLimits,
} from "../helpers/partition-journal-cases.js";
import { withImmutableSessionMigrationSource } from "../../src/workspace-lifecycle/immutable-session-migration-source.js";
import {
  auditImmutableOperationReceiptFrames,
  importImmutableOperationReceipts,
} from "../../src/workspace-lifecycle/import-immutable-operation-receipts.js";
import { importImmutableSessionBusinessState } from "../../src/workspace-lifecycle/import-immutable-session-business-state.js";
import { reconcileImmutableSessionStaging } from "../../src/workspace-lifecycle/reconcile-immutable-session-staging.js";
import { commitImmutableSessionChanges } from "../helpers/commit-immutable-session-fixture.js";
import { immutableLifecycleCommandKey } from "../../src/session/session-artifact-session/immutable-command-index.js";
import { readSessionStorageAuthority } from "../../src/session/session-storage-authority.js";
import {
  checkpointWorkspace,
  migratedWorkspace,
} from "../workspace-session-immutable-storage-upgrade.test-helpers.js";
import {
  committedAt,
  openTestMessages,
  prepare,
} from "./partition-session-messages.test-helpers.js";
import {
  sessionId,
  scope,
  message,
  initializeStaging,
  importStagingMessages,
  targetStorageBudget,
} from "./immutable-session-migration-cases.js";

test("partition business commit replays imported evidence without publishing a transaction", async (t) => {
  const { sessionDir, store, request: legacy } = await checkpointWorkspace(t);
  const { journal, root } = await createTransactionCase(t, {}, { sessionId });
  await withImmutableSessionMigrationSource({ sessionDir, expectedSource: null }, (source) =>
    initializeStaging(journal, source),
  );
  const expectedGeneration = (await store.snapshot()).generation;
  const command = {
    operationId: "create-after-legacy-checkpoint",
    committedAt,
    changes: { messages: [message(3)] },
  };
  const original = await commitImmutableSessionChanges(store, { expectedGeneration, ...command });
  await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    async (source) => {
      await importImmutableOperationReceipts({ source, journal, scope });
    },
  );
  await journal.close();
  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const repository = openTestMessages(reopened, sessionId);
  const before = await readFile(join(root, "CURRENT"));
  const sequence = reopened.head.sequence;
  const prepareOriginal = (input, generation = expectedGeneration) =>
    prepareScopedSessionCommitRequest({ epoch: null, expectedGeneration: generation }, input);
  const prepared = prepareOriginal(command);
  const replay = await repository.commit(prepared);
  assert.deepEqual(replay, { ...original, replayed: true });
  await assert.rejects(
    repository.commit(
      prepareOriginal({ ...command, changes: { messages: [message(3, "changed")] } }),
    ),
    { code: "SESSION_OPERATION_CONFLICT" },
  );
  await assert.rejects(
    repository.commit(prepareOriginal({ ...command, operationId: "missing-original" })),
    { code: "SESSION_REQUEST_EPOCH" },
  );
  await assert.rejects(
    repository.commit(
      prepareOriginal(
        {
          operationId: legacy.operationId,
          changes: legacy.changes,
          committedAt: legacy.committedAt,
        },
        legacy.expectedGeneration,
      ),
    ),
    { code: "SESSION_OPERATION_RETRY_UNAVAILABLE" },
  );
  const wrongScope = new PartitionSessionTransactions(reopened, {
    ...scope,
    parentSessionId: "other",
  });
  await assert.rejects(
    wrongScope.commit(prepared, () => assert.fail("out-of-scope request entered preparation")),
    { code: "SESSION_SCOPE_IDENTITY_CONFLICT" },
  );
  assert.equal(reopened.head.sequence, sequence);
  assert.deepEqual(await readFile(join(root, "CURRENT")), before);
});

for (const bytes of [3000, 4096]) {
  test(`historical receipt frame budget and cold replay: ${bytes} result bytes`, async (t) => {
    const { sessionDir, store } = await migratedWorkspace(t);
    const { journal, root } = await createTransactionCase(t, {}, { sessionId });
    const operationId = "large-historical-receipt";
    const expectedGeneration = (await store.snapshot()).generation;
    const input = { command: "fixture" };
    const original = await store.transact({
      expectedGeneration,
      operationId,
      input,
      prepare: () => ({ changes: [], result: { payload: "x".repeat(bytes) } }),
    });
    const current = join(root, "CURRENT");
    await withImmutableSessionMigrationSource(
      { sessionDir, expectedSource: null },
      async (source) => {
        await initializeStaging(journal, source);
        const before = await readFile(current);
        const sequence = journal.head.sequence;
        const audit = () =>
          auditImmutableOperationReceiptFrames({
            source,
            destination: journal.head,
            readExisting: () => null,
          });
        const overBudget = { code: "SESSION_TRANSACTION_BUDGET", operationId };
        if (bytes === journal.head.limits.transactionBytes) {
          await assert.rejects(audit, overBudget);
        } else {
          const { frameCount, maxFrameBytes } = await audit();
          assert.equal(frameCount, source.identity.generation);
          assert.ok(maxFrameBytes > bytes && maxFrameBytes <= journal.head.limits.transactionBytes);
        }
        assert.deepEqual(await readFile(current), before);
        const importReceipts = () => importImmutableOperationReceipts({ source, journal, scope });
        if (bytes === journal.head.limits.transactionBytes) {
          await assert.rejects(importReceipts, overBudget);
          assert.equal(journal.head.sequence, sequence);
          assert.deepEqual(await readFile(current), before);
        } else {
          await importReceipts();
        }
      },
    );
    await journal.close();
    const reopened = await PartitionJournal.open({ root, sessionId });
    t.after(() => reopened.close());
    const before = await readFile(current);
    const replay = () =>
      new PartitionSessionTransactions(reopened, scope).commit(
        { epoch: null, expectedGeneration, operationId, input },
        () => assert.fail("historical request entered preparation"),
      );
    if (bytes === reopened.head.limits.transactionBytes)
      await assert.rejects(replay, { code: "SESSION_REQUEST_EPOCH" });
    else assert.deepEqual(await replay(), { ...original, replayed: true });
    assert.deepEqual(await readFile(current), before);
  });
}

test("offline reconciliation imports receipts after cold open and resumes without another write", async (t) => {
  const { base, sessionDir, store } = await migratedWorkspace(t);
  const { journal, root } = await createTransactionCase(t, {}, { sessionId });
  const head = await store.snapshot();
  const metadata = {
    ...(await store.get(head, "metadata", "session")),
    aggregateVersion: 7,
    updatedAt: committedAt,
  };
  await store.commit({
    expectedGeneration: head.generation,
    operationId: "advance-source-metadata",
    changes: [{ collection: "metadata", key: "session", value: metadata }],
  });
  const authority = await readSessionStorageAuthority(sessionDir);
  const expectedSource = await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    async (source) => {
      await importImmutableSessionBusinessState({ source, journal, limit: 1, maxBytes: 4096 });
      return source.identity;
    },
  );
  const { epoch, sequence } = journal.head;
  await journal.close();
  const options = {
    sessionDir,
    stagingDir: root,
    expectedSource,
    targetStorageBudget,
    limit: 1,
    maxBytes: 4096,
  };
  const alias = join(base, "source-alias");
  await symlink(sessionDir, alias);
  await assert.rejects(
    reconcileImmutableSessionStaging({ ...options, stagingDir: alias }),
    /directories must be disjoint/,
  );
  const usingSnapshot = PartitionJournal.prototype.usingSnapshot;
  const snapshotReads = t.mock.method(PartitionJournal.prototype, "usingSnapshot", function (run) {
    return usingSnapshot.call(this, run);
  });
  const report = await reconcileImmutableSessionStaging(options);
  assert.equal(snapshotReads.mock.callCount(), 3);
  snapshotReads.mock.restore();
  assert.deepEqual(report, {
    source: expectedSource,
    target: { sessionId, epoch, generation: sequence + expectedSource.generation },
    messageCount: 3,
    receiptCount: expectedSource.generation,
    dialogCount: 3,
  });
  const current = join(root, "CURRENT");
  const reconciledHead = await readFile(current);
  assert.deepEqual(await reconcileImmutableSessionStaging(options), report);
  await store.commit({
    expectedGeneration: expectedSource.generation,
    operationId: "advance-before-reconciliation",
    changes: [{ collection: "metadata", key: "scoped", value: { changed: true } }],
  });
  await assert.rejects(reconcileImmutableSessionStaging(options), {
    code: "SESSION_MIGRATION_SOURCE_CHANGED",
  });
  assert.deepEqual(await readFile(current), reconciledHead);
  assert.deepEqual(await readSessionStorageAuthority(sessionDir), authority);
});

test("offline reconciliation rejects missing or mismatched target policy before recovery writes", async (t) => {
  const { sessionDir } = await migratedWorkspace(t);
  const expectedSource = await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    (source) => source.identity,
  );
  const mismatch = { code: "SESSION_STORAGE_POLICY_MISMATCH" };
  for (const [publication, budget, error] of [
    ["collections", undefined, TypeError],
    [
      "collections",
      { ...targetStorageBudget, journalLimits: journalTestLimits({ quotaPartitions: 2048 }) },
      mismatch,
    ],
    ["journal", targetStorageBudget, mismatch],
  ]) {
    const { journal, root } = await createJournalCase(t, {}, { sessionId, publication });
    await journal.close();
    const current = join(root, "CURRENT");
    const before = await readFile(current);
    const pending = `${current}.publish.tmp`;
    await writeFile(pending, "unpublished");
    await assert.rejects(
      reconcileImmutableSessionStaging({
        sessionDir,
        stagingDir: root,
        expectedSource,
        targetStorageBudget: budget,
        limit: 1,
        maxBytes: 4096,
      }),
      error,
    );
    assert.deepEqual(await readFile(current), before);
    assert.equal(await readFile(pending, "utf8"), "unpublished");
  }
});

test("interrupted business import leaves Immutable readable and requires fresh staging", async (t) => {
  const { sessionDir } = await migratedWorkspace(t);
  const { journal, root } = await createTransactionCase(t, {}, { sessionId });
  await journal.close();
  const authority = await readSessionStorageAuthority(sessionDir);
  const expectedSource = await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    (source) => source.identity,
  );
  const options = {
    sessionDir,
    stagingDir: root,
    expectedSource,
    targetStorageBudget,
    limit: 1,
    maxBytes: 4096,
  };
  const controller = new AbortController();
  const failure = new Error("Stop after committing staging metadata");
  const append = PartitionJournal.prototype.appendTransaction;
  const injection = t.mock.method(
    PartitionJournal.prototype,
    "appendTransaction",
    async function (...args) {
      const result = await append.apply(this, args);
      if (this.root === root) controller.abort(failure);
      return result;
    },
  );
  const current = join(root, "CURRENT");
  const empty = await readFile(current);
  try {
    await assert.rejects(
      reconcileImmutableSessionStaging({ ...options, signal: controller.signal }),
      failure,
    );
  } finally {
    injection.mock.restore();
  }
  const partial = await readFile(current);
  assert.notDeepEqual(partial, empty);
  await assert.rejects(reconcileImmutableSessionStaging(options), {
    code: "SESSION_IMMUTABLE_STORAGE_INVALID",
  });
  assert.deepEqual(await readFile(current), partial);
  assert.deepEqual(await readSessionStorageAuthority(sessionDir), authority);
  {
    await using reader = await openImmutableSessionReader({ sessionDir, ...scope });
    assert.equal((await reader.readMetadata()).sessionId, sessionId);
  }
  const fresh = await createTransactionCase(t, {}, { sessionId });
  await fresh.journal.close();
  assert.equal(
    (await reconcileImmutableSessionStaging({ ...options, stagingDir: fresh.root })).messageCount,
    3,
  );
});

test("offline reconciliation rejects different business facts before writing receipts", async (t) => {
  const { sessionDir } = await migratedWorkspace(t);
  const { journal, root } = await createTransactionCase(t, {}, { sessionId });
  const expectedSource = await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    async (source) => {
      await initializeStaging(journal, source);
      await importStagingMessages(journal, source, [
        message(0),
        message(1, "different"),
        message(2),
      ]);
      return source.identity;
    },
  );
  await journal.close();
  const current = join(root, "CURRENT");
  const before = await readFile(current);
  const options = {
    sessionDir,
    stagingDir: root,
    expectedSource,
    targetStorageBudget,
    limit: 1,
    maxBytes: 4096,
  };
  await assert.rejects(
    reconcileImmutableSessionStaging(options),
    /differs from source at position 2/,
  );
  assert.deepEqual(await readFile(current), before);
});

for (const scenario of ["matching", "missing", "changed", "extra"]) {
  test(`offline reconciliation checks a ${scenario} deletion command receipt before importing operations`, async (t) => {
    const { sessionDir, store } = await migratedWorkspace(t);
    const { journal, root } = await createTransactionCase(t, {}, { sessionId });
    const commandId = "delete-last-turn";
    const changes = { messageDeletion: { commandId, anchor: { turnScopeId: "t2" } } };
    const { store: reference } = await migratedWorkspace(t);
    const deleted = await commitImmutableSessionChanges(reference, {
      operationId: commandId,
      expectedGeneration: (await reference.snapshot()).generation,
      committedAt,
      changes,
    });
    const receipt = deleted.result.messageDeletion.receipt;
    if (scenario !== "extra") {
      await store.commit({
        operationId: commandId,
        expectedGeneration: (await store.snapshot()).generation,
        changes: [
          { collection: "commands", key: immutableLifecycleCommandKey(commandId), value: receipt },
        ],
      });
    }
    const expectedSource = await withImmutableSessionMigrationSource(
      { sessionDir, expectedSource: null },
      async (source) => {
        await initializeStaging(journal, source);
        await importStagingMessages(journal, source, [message(0), message(1), message(2)]);
        return source.identity;
      },
    );
    if (scenario !== "missing") {
      const { epoch, sequence } = journal.head;
      const committed = await commitFixtureTransaction(new PartitionTransactions(journal), {
        epoch,
        expectedGeneration: sequence,
        sequence: sequence + 1,
        operationId: "seed-staged-deletion-receipt",
        input: null,
        mutations: [
          {
            collection: "commands",
            key: commandId,
            owner: null,
            value:
              scenario === "changed" ? { ...receipt, requestHash: "different-request" } : receipt,
          },
        ],
        result: null,
      });
      assert.equal(committed.status, "committed");
    }
    await journal.close();
    const current = join(root, "CURRENT");
    const before = await readFile(current);
    const reconcile = () =>
      reconcileImmutableSessionStaging({
        sessionDir,
        stagingDir: root,
        expectedSource,
        targetStorageBudget,
        limit: 1,
        maxBytes: 4096,
      });
    if (scenario === "matching") {
      assert.equal((await reconcile()).receiptCount, expectedSource.generation);
      const reconciled = await readFile(current);
      const reopened = await PartitionJournal.open({ root, sessionId });
      t.after(() => reopened.close());
      const messages = openTestMessages(reopened, sessionId);
      const replay = await messages.commit(
        await prepare(reopened, messages, "retry-deletion-with-new-operation", changes),
      );
      assert.deepEqual(replay.result.messageDeletion, { receipt, deduplicated: true });
      assert.deepEqual(await readFile(current), reconciled);
    } else {
      await assert.rejects(reconcile, {
        code: "SESSION_IMMUTABLE_STORAGE_INVALID",
        message:
          scenario === "extra"
            ? /extra command receipt: delete-last-turn/
            : /command receipt differs from source: delete-last-turn/,
      });
      assert.deepEqual(await readFile(current), before);
    }
  });
}
