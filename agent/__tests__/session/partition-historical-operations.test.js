/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  PARTITION_HISTORICAL_OPERATIONS,
  capturePartitionTransactionRequest,
  createPartitionHistoricalOperationMutation,
  partitionHistoricalOperationAddress,
} from "@noobot/session-protocol/partition-transaction";
import { PartitionJournal } from "../../src/session/partition-storage/partition-journal.js";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { PartitionSessionTransactions } from "../../src/session/partition-storage/partition-session-transactions.js";
import {
  importImmutableOperationReceipts,
  verifyImmutableOperationReceipts,
} from "../../src/workspace-lifecycle/import-immutable-operation-receipts.js";
import { withImmutableSessionMigrationSource } from "../../src/workspace-lifecycle/immutable-session-migration-source.js";
import {
  commitFixtureTransaction,
  createTransactionCase,
} from "../helpers/partition-journal-cases.js";
import { checkpointWorkspace } from "../workspace-session-immutable-storage-upgrade.test-helpers.js";
import { emptyPartitionSession } from "../helpers/partition-session-cases.js";
import { createAt } from "./partition-transactions.test-helpers.js";

async function createStagingSession(t, scope, limits) {
  const staging = await createTransactionCase(t, limits, {
    autoClose: false,
    sessionId: scope.sessionId,
  });
  const { journal } = staging;
  t.after(() => journal.close());
  const committedAt = "2026-01-01T00:00:00.000Z";
  const session = new PartitionSessionTransactions(journal, scope);
  const initialization = await journal.usingSnapshot((snapshot) =>
    session.prepareInitialization(snapshot, {
      operationId: "initialize-partition-staging",
      session: emptyPartitionSession({ ...scope, committedAt }),
      scopedMetadata: null,
    }),
  );
  await session.initialize(initialization);
  return staging;
}

test("historical receipt import shares publication within the queue bound and cold reconciles", async (t) => {
  const { sessionDir, store } = await checkpointWorkspace(t);
  const scope = { sessionId: store.sessionId, parentSessionId: "" };
  const { journal, root, sessionId } = await createStagingSession(t, scope, {
    transactionBytes: 16 * 1024,
    queueBytes: 32 * 1024,
  });
  const { generation } = await store.snapshot();
  for (let index = 0; index < 5; index += 1) {
    await store.transact({
      expectedGeneration: generation + index,
      operationId: `migration-receipt-batch-${index}`,
      input: null,
      prepare: () => ({ changes: [], result: null }),
    });
  }
  const batches = new Map();
  const append = journal.appendTransaction.bind(journal);
  t.mock.method(journal, "appendTransaction", (identity, { validateScope, prepare }) =>
    append(identity, {
      validateScope,
      async prepare(snapshot, staged, targetGeneration) {
        const result = await prepare(snapshot, staged, targetGeneration);
        const [mutation] = result.mutations;
        assert.equal(mutation.collection, PARTITION_HISTORICAL_OPERATIONS);
        const batch = batches.get(snapshot.sequence) ?? [];
        batch.push(mutation.value.receipt.generation);
        batches.set(snapshot.sequence, batch);
        return result;
      },
    }),
  );
  await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    async (source) => {
      await importImmutableOperationReceipts({ source, journal, scope });
      const sourceGenerations = Array.from({ length: source.generation }, (_, index) => index + 1);
      const expected = [];
      for (let offset = 0; offset < sourceGenerations.length; offset += 2)
        expected.push(sourceGenerations.slice(offset, offset + 2));
      assert.deepEqual([...batches.values()], expected);
      await journal.close();
      const reopened = await PartitionJournal.open({ root, sessionId });
      t.after(() => reopened.close());
      const before = await readFile(join(root, "CURRENT"));
      await importImmutableOperationReceipts({ source, journal: reopened, scope });
      assert.deepEqual(await readFile(join(root, "CURRENT")), before);
      assert.equal(await verifyReceipts({ source, journal: reopened, scope }), source.generation);
    },
  );
});

test("all pinned source receipts remain authoritative after rotation, eviction and cold open", async (t) => {
  const { sessionDir, store, request } = await checkpointWorkspace(t);
  const scope = { sessionId: store.sessionId, parentSessionId: "" };
  const { journal, root, sessionId } = await createStagingSession(t, scope, {
    partitionRecords: 1,
    transactionBytes: 16 * 1024,
    receiptRecords: 1,
  });
  const operations = new Map();
  await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    async (source) => {
      await source.visitOperations((operation) => operations.set(operation.operationId, operation));
      assert.equal(operations.size, source.generation);
      await importImmutableOperationReceipts({ source, journal, scope });
    },
  );
  assert.ok(operations.has(request.operationId));
  const writer = new PartitionTransactions(journal);
  const generation = operations.size + 2;
  assert.equal(
    (await commitFixtureTransaction(writer, createAt(journal, generation))).generation,
    generation,
  );
  await journal.close();

  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const target = new PartitionTransactions(reopened);
  await reopened.usingSnapshot(async (snapshot) => {
    const address = partitionHistoricalOperationAddress(request.operationId);
    for (const evidence of operations.values()) {
      const { collection, key } = partitionHistoricalOperationAddress(evidence.operationId);
      const receipts = await target.getLatestMany({ snapshot, collection, keys: [key] });
      assert.deepEqual(receipts.get(key).value, evidence);
    }
    const pointLookup = /Historical operations require session-wide point lookup/;
    await assert.rejects(
      target.readKeysByCollection(snapshot, ["messages", address.collection]),
      pointLookup,
    );
    await assert.rejects(
      target.getMany({
        snapshot,
        partition: 0,
        collection: address.collection,
        keys: [address.key],
      }),
      pointLookup,
    );
    await assert.rejects(
      target.getLatestByOwner({ snapshot, collection: address.collection, entities: [] }),
      pointLookup,
    );
  });
  const current = join(root, "CURRENT");
  const before = await readFile(current);
  for (const evidence of operations.values()) {
    const { identity } = capturePartitionTransactionRequest(
      {
        epoch: reopened.head.epoch,
        expectedGeneration: generation,
        operationId: evidence.operationId,
        input: {},
      },
      reopened.head.limits,
    );
    await assert.rejects(
      reopened.appendTransaction(identity, {
        validateScope: () => {},
        prepare: () => assert.fail("Historical operation reached business preparation"),
      }),
      {
        code: "SESSION_OPERATION_RETRY_UNAVAILABLE",
        operationId: evidence.operationId,
        sourceGeneration: evidence.receipt.generation,
      },
    );
  }
  assert.deepEqual(await readFile(current), before);
  assert.equal(
    (await commitFixtureTransaction(target, createAt(reopened, generation + 1))).generation,
    generation + 1,
  );
});

test("an aborted receipt prevents later preparation and leaves the source authoritative", async (t) => {
  const { sessionDir, store } = await checkpointWorkspace(t);
  const scope = { sessionId: store.sessionId, parentSessionId: "" };
  const { journal, root, sessionId } = await createStagingSession(t, scope, {
    transactionBytes: 16 * 1024,
    queueBytes: 32 * 1024,
  });
  const { generation } = await store.snapshot();
  await store.transact({
    expectedGeneration: generation,
    operationId: "must-not-enter-next-receipt-batch",
    input: null,
    prepare: () => ({ changes: [], result: null }),
  });
  const append = journal.appendTransaction.bind(journal);
  const attempts = [];
  const prepared = [];
  t.mock.method(journal, "appendTransaction", (identity, callbacks) => {
    attempts.push(identity.operationId);
    return append(identity, {
      ...callbacks,
      prepare: () => {
        prepared.push(identity.operationId);
        return { action: "abort", result: null };
      },
    });
  });

  const current = join(root, "CURRENT");
  const initial = await readFile(current);
  const { identity, operations } = await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    async (source) => {
      const operations = [];
      await source.visitOperations((operation) => operations.push(operation));
      assert.ok(operations.length > 2);
      await assert.rejects(importImmutableOperationReceipts({ source, journal, scope }), (error) =>
        error.message.includes(operations[0].operationId),
      );
      return { identity: source.identity, operations };
    },
  );
  assert.deepEqual(
    attempts,
    operations.slice(0, 2).map(({ operationId }) => operationId),
  );
  assert.deepEqual(prepared, [operations[0].operationId]);
  assert.deepEqual(await readFile(current), initial);
  await journal.close();

  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  await reopened.usingSnapshot(async (snapshot) => {
    const target = new PartitionTransactions(reopened);
    assert.equal(snapshot.sequence, 1);
    for (const { operationId } of operations) {
      const { collection, key } = partitionHistoricalOperationAddress(operationId);
      assert.equal(
        (await target.getLatestMany({ snapshot, collection, keys: [key] })).get(key),
        null,
      );
    }
  });
  await withImmutableSessionMigrationSource({ sessionDir, expectedSource: identity }, (source) =>
    assert.deepEqual(source.identity, identity),
  );
});

test("quota rejection leaves only the committed receipt prefix in the offline journal", async (t) => {
  const { sessionDir, store } = await checkpointWorkspace(t);
  const scope = { sessionId: store.sessionId, parentSessionId: "" };
  const { journal, root, sessionId } = await createStagingSession(t, scope, {
    transactionBytes: 16 * 1024,
    partitionRecords: 1,
    quotaPartitions: 2,
  });
  const { identity, operations } = await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    async (source) => {
      const operations = [];
      await source.visitOperations((operation) => operations.push(operation));
      assert.ok(operations.length > 1);
      await assert.rejects(importImmutableOperationReceipts({ source, journal, scope }), {
        code: "SESSION_STORAGE_QUOTA",
      });
      return { identity: source.identity, operations };
    },
  );
  await journal.close();

  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  await reopened.usingSnapshot(async (snapshot) => {
    const target = new PartitionTransactions(reopened);
    assert.equal(snapshot.sequence, 2);
    for (const [index, evidence] of operations.entries()) {
      const { collection, key } = partitionHistoricalOperationAddress(evidence.operationId);
      const receipt = (await target.getLatestMany({ snapshot, collection, keys: [key] })).get(key);
      if (index === 0) assert.deepEqual(receipt.value, evidence);
      else assert.equal(receipt, null);
    }
  });
  await withImmutableSessionMigrationSource({ sessionDir, expectedSource: identity }, (source) =>
    assert.deepEqual(source.identity, identity),
  );
});

function verifyReceipts({ source, journal, scope }) {
  return journal.usingSnapshot((snapshot) =>
    verifyImmutableOperationReceipts({ source, journal, snapshot, scope }),
  );
}

test("offline receipt migration rejects a target initialized under a different parent", async (t) => {
  const { sessionDir, store } = await checkpointWorkspace(t);
  const scope = { sessionId: store.sessionId, parentSessionId: "different-parent" };
  const { journal, root } = await createStagingSession(t, scope, { transactionBytes: 16 * 1024 });
  const current = join(root, "CURRENT");
  const before = await readFile(current);
  await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: null },
    async (source) => {
      for (const run of [importImmutableOperationReceipts, verifyReceipts])
        await assert.rejects(run({ source, journal, scope }), {
          message: /^session identity conflicts with its storage scope:/,
        });
    },
  );
  assert.deepEqual(await readFile(current), before);
});

test("cold resume verifies the committed receipt prefix without appending it again", async (t) => {
  const { sessionDir, store } = await checkpointWorkspace(t);
  const scope = { sessionId: store.sessionId, parentSessionId: "" };
  const { journal, root, sessionId } = await createStagingSession(t, scope, {
    transactionBytes: 16 * 1024,
    partitionRecords: 1,
    receiptRecords: 1,
    pageRecords: 1,
  });
  const stopped = new Error("receipt import interrupted");
  const controller = new AbortController();
  let identity;
  await assert.rejects(
    withImmutableSessionMigrationSource(
      { sessionDir, expectedSource: null, signal: controller.signal },
      async (source) => {
        identity = source.identity;
        const append = journal.appendTransaction.bind(journal);
        t.mock.method(journal, "appendTransaction", async (...args) => {
          const receipt = await append(...args);
          controller.abort(stopped);
          return receipt;
        });
        await importImmutableOperationReceipts({ source, journal, scope });
      },
    ),
    (cause) => cause === stopped,
  );
  assert.equal(journal.head.sequence, 2);
  await journal.close();

  const reopened = await PartitionJournal.open({ root, sessionId });
  t.after(() => reopened.close());
  const current = join(root, "CURRENT");
  const beforeResume = await readFile(current);
  await withImmutableSessionMigrationSource(
    { sessionDir, expectedSource: identity },
    async (source) => {
      const truncatedSource = {
        ...source,
        visitOperations: (visit) =>
          source.visitOperations((evidence) =>
            evidence.receipt.generation === 1 ? visit(evidence) : undefined,
          ),
      };
      for (const run of [verifyReceipts, importImmutableOperationReceipts])
        await assert.rejects(run({ source: truncatedSource, journal: reopened, scope }), {
          code: "SESSION_IMMUTABLE_STORAGE_INVALID",
          message: /Migration operation stream ended before its pinned head/,
        });
      assert.deepEqual(await readFile(current), beforeResume);
      const invalidStreams = [
        {
          change: (receipt) => ({ ...receipt, generation: 1 }),
          message: /Migration operation stream is not in pinned generation order/,
        },
        {
          change: (receipt) => ({
            ...receipt,
            commit: `${receipt.commit[0] === "0" ? "1" : "0"}${receipt.commit.slice(1)}`,
          }),
          message: /Migration operation stream disagrees with its pinned head/,
        },
      ];
      for (const { change, message } of invalidStreams) {
        const invalidSource = {
          ...source,
          visitOperations: (visit) =>
            source.visitOperations((evidence) =>
              visit(
                evidence.receipt.generation === identity.generation
                  ? { ...evidence, receipt: change(evidence.receipt) }
                  : evidence,
              ),
            ),
        };
        for (const run of [verifyReceipts, importImmutableOperationReceipts])
          await assert.rejects(run({ source: invalidSource, journal: reopened, scope }), {
            code: "SESSION_IMMUTABLE_STORAGE_INVALID",
            message,
          });
        assert.deepEqual(await readFile(current), beforeResume);
      }
      const conflictingSource = {
        ...source,
        visitOperations: (visit) =>
          source.visitOperations((evidence) =>
            visit({ ...evidence, receipt: { ...evidence.receipt, digest: "0".repeat(64) } }),
          ),
      };
      await assert.rejects(verifyReceipts({ source, journal: reopened, scope }), {
        code: "SESSION_IMMUTABLE_STORAGE_INVALID",
        message: /^Missing staged receipt: /,
      });
      await assert.rejects(
        verifyReceipts({ source: conflictingSource, journal: reopened, scope }),
        { code: "SESSION_MIGRATION_SOURCE_CHANGED" },
      );
      await assert.rejects(
        importImmutableOperationReceipts({ source: conflictingSource, journal: reopened, scope }),
        {
          code: "SESSION_MIGRATION_SOURCE_CHANGED",
        },
      );
      assert.deepEqual(await readFile(current), beforeResume);
      await importImmutableOperationReceipts({ source, journal: reopened, scope });
      const completed = await readFile(current);
      assert.equal(reopened.head.sequence, identity.generation + 1);
      assert.equal(await verifyReceipts({ source, journal: reopened, scope }), identity.generation);
      assert.deepEqual(await readFile(current), completed);
      await importImmutableOperationReceipts({ source, journal: reopened, scope });
      assert.deepEqual(await readFile(current), completed);
      const extra = {
        format: "noobot.immutable-migration-operation/1",
        operationId: "extra-staged-operation",
        receipt: { generation: 90, commit: "a".repeat(64), digest: "b".repeat(64), result: null },
      };
      const published = await commitFixtureTransaction(new PartitionTransactions(reopened), {
        ...createAt(reopened, reopened.head.sequence + 1),
        operationId: extra.operationId,
        mutations: [createPartitionHistoricalOperationMutation(extra)],
      });
      assert.equal(published.status, "committed");
      await reopened.usingSnapshot(async (snapshot) => {
        const page = await reopened.readSequencePage({ snapshot, sequence: 1 });
        assert.equal(page.done, false);
        assert.ok(page.next.sequence < published.generation);
      });
      const withExtra = await readFile(current);
      await assert.rejects(verifyReceipts({ source, journal: reopened, scope }), {
        code: "SESSION_IMMUTABLE_STORAGE_INVALID",
        message: /^Staged historical receipt count differs from source: /,
      });
      assert.deepEqual(await readFile(current), withExtra);
    },
  );
});

test("later requests in the same batch cannot execute a staged historical operation", async (t) => {
  const { journal } = await createTransactionCase(t, { batchWaitMs: 10 });
  const writer = new PartitionTransactions(journal);
  const evidence = {
    format: "noobot.immutable-migration-operation/1",
    operationId: "historical-operation",
    receipt: { generation: 90, commit: "a".repeat(64), digest: "b".repeat(64), result: null },
  };
  const imported = commitFixtureTransaction(writer, {
    ...createAt(journal, 1),
    operationId: evidence.operationId,
    mutations: [createPartitionHistoricalOperationMutation(evidence)],
  });
  const rejected = assert.rejects(
    writer.commit(
      {
        epoch: journal.head.epoch,
        expectedGeneration: 1,
        operationId: evidence.operationId,
        input: {},
      },
      {
        validateScope: () => {},
        prepare: () => assert.fail("Staged historical operation reached business preparation"),
      },
    ),
    { code: "SESSION_OPERATION_RETRY_UNAVAILABLE" },
  );
  await Promise.all([imported, rejected]);
  assert.equal(journal.head.sequence, 1);
});
