/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  bindImmutableMigrationSource,
  encodeImmutableSessionHead,
  IMMUTABLE_SESSION_HEAD_FILE,
} from "@noobot/session-protocol/immutable-storage";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";
import { withImmutableSessionMigrationSource } from "../../src/workspace-lifecycle/immutable-session-migration-source.js";
import { importImmutableOperationReceipts } from "../../src/workspace-lifecycle/import-immutable-operation-receipts.js";
import { verifyImmutableSessionStaging } from "../../src/workspace-lifecycle/verify-immutable-session-staging.js";
import { reconcileImmutableSessionStaging } from "../../src/workspace-lifecycle/reconcile-immutable-session-staging.js";
import { readSessionStorageAuthority } from "../../src/session/session-storage-authority.js";
import { migratedWorkspace } from "../workspace-session-immutable-storage-upgrade.test-helpers.js";
import { openTestMessages, prepare } from "./partition-session-messages.test-helpers.js";
import {
  sessionId,
  scope,
  message,
  initializeStaging,
  importStagingMessages,
  targetStorageBudget,
} from "./immutable-session-migration-cases.js";

test("offline staging verifies pinned facts and rejects a target advance", async (t) => {
  const { sessionDir } = await migratedWorkspace(t);
  const { journal, root } = await createTransactionCase(t, { pageRecords: 2 }, { sessionId });
  const repository = openTestMessages(journal, sessionId);
  const append = async (index, changes = {}) => {
    const result = await repository.commit(
      await prepare(journal, repository, `append-${index}`, {
        messages: [message(index)],
        ...changes,
      }),
    );
    assert.equal(result.status, "committed");
  };
  const authority = await readSessionStorageAuthority(sessionDir);
  await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    async (source) => {
      assert.equal(Object.hasOwn(await source.readMetadata(), "autoTitle"), false);
      assert.equal(await source.readAutoTitle(), "message 0");
      await initializeStaging(journal, source);
      await importStagingMessages(journal, source, [message(0), message(1), message(2)]);
      const options = { source, journal, scope, limit: 1, maxBytes: 4096 };
      const current = join(root, "CURRENT");
      const before = await readFile(current);
      await assert.rejects(verifyImmutableSessionStaging(options), /Missing staged receipt:/);
      await assert.rejects(
        verifyImmutableSessionStaging(
          {
            ...options,
            source: {
              ...source,
              readMetadata: async () => ({
                ...(await source.readMetadata()),
                autoTitle: "different title",
              }),
            },
          },
          assert.fail,
        ),
        /Staged session metadata differs from the migration source: autoTitle/,
      );
      assert.deepEqual(await readFile(current), before);
      await assert.rejects(
        verifyImmutableSessionStaging(
          {
            ...options,
            source: { ...source, readAutoTitle: async () => "different title" },
          },
          assert.fail,
        ),
        /Staged session automatic title differs from the migration source/,
      );
      assert.deepEqual(await readFile(current), before);
      await importImmutableOperationReceipts({ source, journal, scope });
      const { epoch, sequence: generation } = journal.head;
      assert.deepEqual(await verifyImmutableSessionStaging(options), {
        source: source.identity,
        target: { sessionId, epoch, generation },
        messageCount: 3,
        receiptCount: source.identity.generation,
        dialogCount: 3,
      });
      const readSequencePage = journal.readSequencePage.bind(journal);
      const controller = new AbortController();
      const interrupted = new Error("interrupted after first receipt count page");
      const abortAfterFirstPage = t.mock.method(journal, "readSequencePage", async (selection) => {
        const page = await readSequencePage(selection);
        assert.equal(page.done, false);
        controller.abort(interrupted);
        return page;
      });
      const readNext = t.mock.method(journal, "readPage");
      const publish = t.mock.fn();
      try {
        await assert.rejects(
          verifyImmutableSessionStaging({ ...options, signal: controller.signal }, publish),
          interrupted,
        );
        assert.equal(abortAfterFirstPage.mock.callCount(), 1);
        assert.equal(readNext.mock.callCount(), 0);
        assert.equal(publish.mock.callCount(), 0);
        const { snapshot } = abortAfterFirstPage.mock.calls[0].arguments[0];
        await assert.rejects(readSequencePage({ snapshot, sequence: 1 }), {
          code: "SESSION_SNAPSHOT_RELEASED",
        });
      } finally {
        readNext.mock.restore();
        abortAfterFirstPage.mock.restore();
      }
      const receiptRead = t.mock.method(journal, "readSequencePage", readSequencePage);
      let advancedDuringRead = false;
      try {
        await assert.rejects(
          verifyImmutableSessionStaging({
            ...options,
            source: {
              ...source,
              async readMessagePage(selection) {
                if (!advancedDuringRead) {
                  advancedDuringRead = true;
                  await append(3, { scopedMetadata: { changed: true } });
                }
                return source.readMessagePage(selection);
              },
            },
          }),
          { code: "SESSION_MIGRATION_TARGET_CHANGED" },
        );
        assert.equal(journal.head.sequence, generation + 1);
        const { snapshot } = receiptRead.mock.calls.at(-1).arguments[0];
        assert.equal(snapshot.sequence, generation);
        await assert.rejects(readSequencePage({ snapshot, sequence: 1 }), {
          code: "SESSION_SNAPSHOT_RELEASED",
        });
      } finally {
        receiptRead.mock.restore();
      }
      const advanced = await readFile(current);
      await assert.rejects(verifyImmutableSessionStaging(options), /extra message at position 4/);
      assert.deepEqual(await readFile(current), advanced);
    },
  );
  assert.deepEqual(await readSessionStorageAuthority(sessionDir), authority);
});

test("offline reconciliation rejects dual authority through the journal opener", async (t) => {
  const { sessionDir } = await migratedWorkspace(t);
  const { journal, root } = await createTransactionCase(t, {}, { sessionId });
  await journal.close();
  const expectedSource = await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    (source) => source.identity,
  );
  const current = join(root, "CURRENT");
  const before = await readFile(current);
  await copyFile(
    join(sessionDir, IMMUTABLE_SESSION_HEAD_FILE),
    join(root, IMMUTABLE_SESSION_HEAD_FILE),
  );
  await assert.rejects(
    reconcileImmutableSessionStaging({
      sessionDir,
      stagingDir: root,
      expectedSource,
      targetStorageBudget,
      limit: 1,
      maxBytes: 4096,
    }),
    { code: "SESSION_STORAGE_CORRUPT", message: /multiple storage authorities/ },
  );
  assert.deepEqual(await readFile(current), before);
});

test("offline reconciliation rejects incorrect display source counts before writing receipts", async (t) => {
  const { sessionDir } = await migratedWorkspace(t);
  const { journal, root } = await createTransactionCase(t, {}, { sessionId });
  const expectedSource = await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    async (source) => {
      await initializeStaging(journal, source);
      await importStagingMessages(journal, source, [message(0), message(1), message(2)]);
      return source.identity;
    },
  );
  const transactions = new PartitionTransactions(journal);
  const collection = "metadata";
  const key = "display:statistics";
  const { owner, mutation } = await journal.usingSnapshot((snapshot) =>
    transactions.withCollectionReader(snapshot, async (read) =>
      (await read({ collection, keys: [key], includeOwner: true })).get(key),
    ),
  );
  assert.equal(mutation.value.injectedMessageCount, 0);
  const { epoch, sequence } = journal.head;
  const committed = await commitFixtureTransaction(transactions, {
    epoch,
    expectedGeneration: sequence,
    sequence: sequence + 1,
    operationId: "change-display-source-counts",
    input: null,
    mutations: [{ collection, key, owner, value: { ...mutation.value, injectedMessageCount: 1 } }],
    result: null,
  });
  assert.equal(committed.status, "committed");
  await journal.close();
  const current = join(root, "CURRENT");
  const before = await readFile(current);
  await assert.rejects(
    reconcileImmutableSessionStaging({
      sessionDir,
      stagingDir: root,
      expectedSource,
      targetStorageBudget,
      limit: 1,
      maxBytes: 4096,
    }),
    /Staged display source counts differ/,
  );
  assert.deepEqual(await readFile(current), before);
});

test("migration source fence rejects a different publication with the same commit identity", async (t) => {
  const { sessionDir, store } = await migratedWorkspace(t);
  const committed = await store.snapshot();
  await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: bindImmutableMigrationSource(committed, null) },
    async (source) => {
      await source.withCurrentHead(() => {});
      const republished = {
        ...committed,
        segmentTail: { ...committed.segmentTail, end: committed.segmentTail.end - 1 },
      };
      assert.deepEqual(bindImmutableMigrationSource(republished, null), source.identity);
      await writeFile(
        join(sessionDir, IMMUTABLE_SESSION_HEAD_FILE),
        encodeImmutableSessionHead(republished, republished.format),
      );
      await assert.rejects(source.withCurrentHead(assert.fail), {
        code: "SESSION_MIGRATION_SOURCE_CHANGED",
      });
    },
  );
});

test("offline staging rejects a source advance even when pinned facts match", async (t) => {
  const { sessionDir, store } = await migratedWorkspace(t);
  const { journal } = await createTransactionCase(t, {}, { sessionId });
  await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    async (source) => {
      await initializeStaging(journal, source);
      await importStagingMessages(journal, source, [message(0), message(1), message(2)]);
      await importImmutableOperationReceipts({ source, journal, scope });
      const { sequence } = journal.head;
      let advanced = false;
      await assert.rejects(
        verifyImmutableSessionStaging({
          source: {
            ...source,
            async readMessagePage(selection) {
              if (!advanced) {
                await store.commit({
                  expectedGeneration: source.generation,
                  operationId: "advance-during-reconciliation",
                  changes: [{ collection: "metadata", key: "scoped", value: { changed: true } }],
                });
                advanced = true;
              }
              return source.readMessagePage(selection);
            },
          },
          journal,
          scope,
          limit: 1,
          maxBytes: 4096,
        }),
        { code: "SESSION_MIGRATION_SOURCE_CHANGED" },
      );
      assert.equal((await store.snapshot()).generation, source.generation + 1);
      assert.equal(journal.head.sequence, sequence);
    },
  );
});

for (const [changes, mismatch] of [
  [{ sessionMetadata: { customTitle: "target only" } }, /Staged session metadata differs/],
  [{ scopedMetadata: { targetOnly: true } }, /Staged scoped metadata differs/],
]) {
  test(`offline staging rejects a persisted ${Object.keys(changes)[0]} mismatch`, async (t) => {
    const { sessionDir } = await migratedWorkspace(t);
    const { journal, root } = await createTransactionCase(t, {}, { sessionId });
    const repository = openTestMessages(journal, sessionId);
    await withImmutableSessionMigrationSource(
      { sessionDir, expectedSource: null },
      async (source) => {
        await initializeStaging(journal, source);
        await importStagingMessages(journal, source, [message(0), message(1), message(2)]);
        const request = await prepare(journal, repository, "change-metadata", changes);
        assert.equal((await repository.commit(request)).status, "committed");
        await importImmutableOperationReceipts({ source, journal, scope });
        await journal.close();
        const reopened = await PartitionJournal.open({ root, sessionId });
        t.after(() => reopened.close());
        const current = join(root, "CURRENT");
        const before = await readFile(current);
        await assert.rejects(
          verifyImmutableSessionStaging({
            source,
            journal: reopened,
            scope,
            limit: 1,
            maxBytes: 4096,
          }),
          { code: "SESSION_IMMUTABLE_STORAGE_INVALID", message: mismatch },
        );
        assert.deepEqual(await readFile(current), before);
      },
    );
  });
}
