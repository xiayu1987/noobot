/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { partitionJournalError } from "./errors.js";
import { PARTITION_JOURNAL_FRAME } from "./partition-journal-frame-layout.js";
import {
  partitionEntityPageBytes,
  partitionProjectionPageReservation,
} from "./partition-entity-page-budget.js";

export class PartitionAdmissionRejection extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class PartitionProjectionBackpressure extends PartitionAdmissionRejection {
  constructor() {
    super(
      "SESSION_ENTITY_PROJECTION_BACKPRESSURE",
      "Deferred entity updates must be published before appending more records",
    );
  }
}

export function partitionJournalBatchBudget(limits) {
  return {
    records: Math.min(limits.batchRecords, limits.receiptRecords),
    bytes: Math.min(limits.batchBytes, limits.receiptBytes),
  };
}

export function partitionTransactionSubmissionRecords(limits) {
  return Math.min(
    partitionJournalBatchBudget(limits).records,
    Math.floor(limits.queueBytes / limits.transactionBytes),
  );
}

export function partitionEntityProjectionFits(start, head) {
  return (
    start.partition === head.tail.partition &&
    head.sequence - start.sequence <= head.limits.entityProjectionRecords &&
    head.tail.offset - start.offset <= head.limits.entityProjectionBytes
  );
}

export function finishPartitionEntityProjection(previous, head) {
  const pages = projectionPages(previous);
  if (
    head.entityDirectory.bytes - previous.entityDirectory.bytes >
      pages * partitionEntityPageBytes(head.limits) ||
    head.entityDirectory.segment - previous.entityDirectory.segment > pages
  )
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Entity projection exceeded its reserved capacity",
    );
  head.deferredEntityUpdates = null;
}

export function partitionJournalReservedBytes(head) {
  const reserved =
    head.dataBytes +
    head.entityDirectory.bytes +
    projectionPages(head) * partitionEntityPageBytes(head.limits) +
    2 * head.limits.partitionBytes +
    head.sequence * PARTITION_JOURNAL_FRAME.offsetBytes +
    (head.tail.partition + 2) *
      (PARTITION_JOURNAL_FRAME.directoryBytes + PARTITION_JOURNAL_FRAME.controlBytes) +
    (head.limits.retentionRecords + 3) * PARTITION_JOURNAL_FRAME.controlBytes +
    head.limits.reserveBytes;
  return Number.isSafeInteger(reserved) ? reserved : Infinity;
}

function projectionPages(head) {
  return head.deferredEntityUpdates
    ? partitionProjectionPageReservation(
        head.limits,
        head.entityDirectory.latestUpdates,
        head.deferredEntityUpdates.mutationCount,
      )
    : 0;
}

export function partitionEntityUnpublishedSegmentBudget(head) {
  return Math.max(partitionJournalBatchBudget(head.limits).records, projectionPages(head));
}

export function requirePartitionEntityPublicationExtent(previous, next) {
  if (
    next.segment - previous.entityDirectory.segment >
    partitionEntityUnpublishedSegmentBudget(previous)
  )
    throw new PartitionAdmissionRejection(
      "SESSION_INDEX_BUDGET",
      "Entity directory publication exceeds its recoverable segment budget",
    );
}

export function partitionJournalReservedInodes(head) {
  const reserved =
    5 +
    (head.tail.partition + 1) * 6 +
    head.entityDirectory.segment +
    projectionPages(head) +
    4 +
    1 +
    2 * head.limits.retentionRecords +
    head.limits.reserveInodes;
  return Number.isSafeInteger(reserved) ? reserved : Infinity;
}

export function partitionJournalHasCapacity(head) {
  return (
    head.tail.partition < head.limits.quotaPartitions &&
    partitionJournalReservedBytes(head) <= head.limits.quotaBytes &&
    partitionJournalReservedInodes(head) <= head.limits.quotaInodes
  );
}

export function requiresImmediatePartitionProjection(accepted, next) {
  const pending = next.deferredEntityUpdates;
  if (
    pending === null ||
    (partitionEntityProjectionFits(pending.start, next) && partitionJournalHasCapacity(next))
  )
    return false;
  if (accepted.deferredEntityUpdates !== null) throw new PartitionProjectionBackpressure();
  return true;
}

export function requirePartitionPublicationCapacity(head) {
  if (partitionJournalHasCapacity(head)) return;
  throw new PartitionAdmissionRejection(
    "SESSION_STORAGE_QUOTA",
    "Journal capacity reservation is exhausted",
  );
}
