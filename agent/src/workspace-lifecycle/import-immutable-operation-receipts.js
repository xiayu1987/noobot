/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { assertSessionScopeIdentity } from "@noobot/session-protocol";
import {
  PARTITION_HISTORICAL_OPERATIONS,
  assertPartitionHistoricalOperationEvidence,
  capturePartitionTransactionRequest,
  createPartitionTransactionRequest,
  partitionHistoricalOperationAddress,
  preparePartitionHistoricalOperationImport,
} from "@noobot/session-protocol/partition-transaction";
import {
  PARTITION_JOURNAL_FRAME,
  encodePartitionJournalFrameRequest,
  partitionTransactionSubmissionRecords,
} from "@noobot/session-protocol/partition-journal";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import { visitPinnedImmutableMigrationOperations } from "@noobot/session-protocol/immutable-operation-receipt";
import { PartitionSessionTransactions } from "../session/partition-storage/partition-session-transactions.js";

function receiptTransactions({ source, journal, scope }) {
  assertSessionScopeIdentity({ ...scope, session: source.scope });
  if (source.identity.sessionId !== scope.sessionId || journal.head.sessionId !== scope.sessionId)
    throw immutableStorageError(
      "Migration receipt source and destination session identities disagree",
    );
  return new PartitionSessionTransactions(journal, scope);
}

async function readReceipt(transactions, snapshot, operationId) {
  const { collection, key } = partitionHistoricalOperationAddress(operationId);
  return transactions.read(snapshot, async (read) =>
    (await read({ collection, keys: [key], includeOwner: true })).get(key),
  );
}

export async function auditImmutableOperationReceiptFrames({
  source,
  destination,
  readExisting,
  signal,
}) {
  signal?.throwIfAborted();
  const { epoch, limits, publication } = destination;
  let sequence = destination.sequence;
  let frameCount = 0;
  let maxFrameBytes = 0;
  await visitPinnedImmutableMigrationOperations(source, async (evidence) => {
    signal?.throwIfAborted();
    const { operationId } = evidence;
    const existing = await readExisting(operationId);
    if (existing !== null) {
      assertPartitionHistoricalOperationEvidence(existing.mutation, evidence);
      return;
    }
    const { request, prepared } = preparePartitionHistoricalOperationImport(
      { epoch, sequence },
      evidence,
    );
    try {
      const { identity } = capturePartitionTransactionRequest(request, limits);
      const { body } = encodePartitionJournalFrameRequest(
        createPartitionTransactionRequest(identity, prepared),
        limits,
        publication,
      );
      const frameBytes =
        PARTITION_JOURNAL_FRAME.headerBytes + body.length + PARTITION_JOURNAL_FRAME.trailer.length;
      maxFrameBytes = Math.max(maxFrameBytes, frameBytes);
      frameCount += 1;
      sequence = identity.sequence;
    } catch (cause) {
      if (cause.code !== "SESSION_TRANSACTION_BUDGET") throw cause;
      throw Object.assign(
        new Error(`Historical operation exceeds destination transaction budget: ${operationId}`, {
          cause,
        }),
        { code: cause.code, operationId },
      );
    }
  });
  return { frameCount, maxFrameBytes };
}

async function commitReceiptBatch(transactions, batch) {
  const outcomes = await Promise.allSettled(
    batch.map(async ({ request, prepared }) => {
      const outcome = await transactions.commit(request, () => prepared);
      if (outcome.status !== "committed" || outcome.generation !== request.expectedGeneration + 1)
        throw immutableStorageError(`Migration receipt was not committed: ${request.operationId}`);
    }),
  );
  for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
}

export async function importImmutableOperationReceipts({ source, journal, scope, signal }) {
  const transactions = receiptTransactions({ source, journal, scope });
  await journal.usingSnapshot(async (snapshot) => {
    const readExisting = (operationId) => readReceipt(transactions, snapshot, operationId);
    await auditImmutableOperationReceiptFrames({
      source,
      destination: snapshot,
      readExisting,
      signal,
    });
    const batchRecords = partitionTransactionSubmissionRecords(snapshot.limits);
    const batch = [];
    let sequence = snapshot.sequence;
    await visitPinnedImmutableMigrationOperations(source, async (evidence) => {
      signal?.throwIfAborted();
      const { operationId } = evidence;
      const existing = await readExisting(operationId);
      if (existing !== null) {
        assertPartitionHistoricalOperationEvidence(existing.mutation, evidence);
        return;
      }
      batch.push(
        preparePartitionHistoricalOperationImport({ epoch: snapshot.epoch, sequence }, evidence),
      );
      sequence += 1;
      if (batch.length === batchRecords) {
        await commitReceiptBatch(transactions, batch);
        batch.length = 0;
      }
    });
    signal?.throwIfAborted();
    if (batch.length !== 0) await commitReceiptBatch(transactions, batch);
  });
}

function countHistoricalReceiptMutations(mutations) {
  let count = 0;
  for (const { collection } of mutations)
    if (collection === PARTITION_HISTORICAL_OPERATIONS) count += 1;
  return count;
}

async function countStagedReceipts(journal, snapshot, signal) {
  signal?.throwIfAborted();
  let count = 0;
  let page = await journal.readSequencePage({ snapshot, sequence: 1 });
  while (true) {
    signal?.throwIfAborted();
    for (const { request } of page.records)
      count += countHistoricalReceiptMutations(request.payload.mutations);
    if (page.done) return count;
    page = await journal.readPage({ snapshot, cursor: page.next });
  }
}

export async function verifyImmutableOperationReceipts({
  source,
  journal,
  snapshot,
  scope,
  signal,
}) {
  signal?.throwIfAborted();
  const transactions = receiptTransactions({ source, journal, scope });
  await transactions.readMetadata(snapshot);
  const { generation: expectedCount } = await visitPinnedImmutableMigrationOperations(
    source,
    async (evidence) => {
      signal?.throwIfAborted();
      const { operationId } = evidence;
      const entry = await readReceipt(transactions, snapshot, operationId);
      if (entry === null) throw immutableStorageError(`Missing staged receipt: ${operationId}`);
      assertPartitionHistoricalOperationEvidence(entry.mutation, evidence);
    },
  );
  const actualCount = await countStagedReceipts(journal, snapshot, signal);
  if (actualCount !== expectedCount)
    throw immutableStorageError(
      `Staged historical receipt count differs from source: expected ${expectedCount}, got ${actualCount}`,
    );
  return actualCount;
}
