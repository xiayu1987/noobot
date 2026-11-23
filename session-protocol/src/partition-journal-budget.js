/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { partitionEntityPageCapacity } from "./partition-entity-page-budget.js";
import { partitionJournalHasCapacity } from "./partition-journal-capacity.js";
import { exactObject, positive } from "./partition-journal-fields.js";
import { PARTITION_JOURNAL_FRAME } from "./partition-journal-frame-layout.js";

export function requirePartitionJournalLimits(limits) {
  exactObject(
    limits,
    [
      "partitionBytes",
      "partitionRecords",
      "transactionBytes",
      "queueBytes",
      "batchBytes",
      "batchRecords",
      "batchWaitMs",
      "receiptBytes",
      "receiptRecords",
      "entityProjectionBytes",
      "entityProjectionRecords",
      "retentionRecords",
      "pageBytes",
      "pageRecords",
      "quotaBytes",
      "quotaPartitions",
      "quotaInodes",
      "reserveBytes",
      "reserveInodes",
    ],
    "partition journal limits",
  );
  for (const [key, value] of Object.entries(limits))
    if (key !== "batchWaitMs") positive(value, key);

  if (!Number.isSafeInteger(limits.batchWaitMs) || limits.batchWaitMs < 0)
    throw new TypeError("Invalid batchWaitMs");
  if (
    limits.transactionBytes <=
      PARTITION_JOURNAL_FRAME.headerBytes + PARTITION_JOURNAL_FRAME.trailer.length ||
    limits.transactionBytes > PARTITION_JOURNAL_FRAME.maxPayloadBytes ||
    limits.batchWaitMs > PARTITION_JOURNAL_FRAME.maxTimerMs ||
    limits.transactionBytes > limits.partitionBytes ||
    limits.transactionBytes > limits.batchBytes ||
    limits.batchBytes > limits.queueBytes ||
    limits.transactionBytes > limits.receiptBytes ||
    limits.transactionBytes > limits.pageBytes ||
    limits.transactionBytes > limits.entityProjectionBytes ||
    !partitionJournalHasCapacity(emptyJournalState(limits))
  )
    throw new TypeError("Inconsistent partition journal budgets");
  return Object.freeze({ ...limits });
}

export function requireCollectionPageCapacity(limits) {
  if (partitionEntityPageCapacity(limits) < 4)
    throw new TypeError("Entity directory page budget requires fanout of at least four");
}

export function requirePartitionSessionStorageBudget(budget) {
  exactObject(budget, ["journalLimits", "maxJournals"], "partition session storage budget");
  positive(budget.maxJournals, "maxJournals");
  const journalLimits = requirePartitionJournalLimits(budget.journalLimits);
  requireCollectionPageCapacity(journalLimits);
  return Object.freeze({ journalLimits, maxJournals: budget.maxJournals });
}

export function emptyJournalState(limits) {
  const cursor = { partition: 0, offset: 0, sequence: 0 };
  return {
    sequence: 0,
    tail: { ...cursor },
    partitionRecords: 0,
    dataBytes: 0,
    receiptStart: { ...cursor },
    limits,
    entityDirectory: {
      identities: null,
      historicalOperations: null,
      latestUpdates: null,
      activeCollection: null,
      segment: 0,
      offset: 0,
      bytes: 0,
    },
    deferredEntityUpdates: null,
  };
}
