/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  PARTITION_JOURNAL_FRAME,
  partitionJournalError,
  requireCapturedPartitionJournalSnapshot,
  requirePartitionJournalCursor,
} from "@noobot/session-protocol/partition-journal";
import {
  CommittedJournalDamage,
  journalPartitionPath,
  openCommittedJournalFile,
  readJournalFrame,
} from "./journal-io.js";
import { findSequencePartition, readPartitionEntry } from "./journal-directory.js";
import { readJournalOffset, readJournalOffsets } from "./journal-offsets.js";
import { withStorageCleanup } from "../../shared/storage/durable-file.js";

function requireReadCursor(head, cursor) {
  requireCapturedPartitionJournalSnapshot(head);
  requirePartitionJournalCursor(cursor);
  if (
    cursor.partition > head.tail.partition ||
    cursor.sequence > head.sequence ||
    (cursor.partition === head.tail.partition && cursor.offset > head.tail.offset) ||
    (cursor.sequence === head.sequence &&
      (cursor.partition !== head.tail.partition || cursor.offset !== head.tail.offset))
  )
    throw new TypeError("Journal cursor exceeds snapshot");
}

function advancePartition(head, next, end) {
  if (end === 0)
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Committed journal partition is empty");
  if (next.partition === head.tail.partition)
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Journal ends before committed sequence",
    );
  next.partition += 1;
  next.offset = 0;
}

function retryWindowBudgetError() {
  return partitionJournalError(
    "SESSION_STORAGE_CORRUPT",
    "Published retry window exceeds its budget",
  );
}

async function readPartitionRecords(
  handle,
  { head, page, end, work, readBudget, byteLimit, recordLimit },
) {
  const { next, records } = page;
  while (next.offset < end && next.sequence < head.sequence && records.length < recordLimit) {
    const remainingBytes = byteLimit - page.bytes;
    const frame = await readJournalFrame(handle, {
      publication: head.publication,
      offset: next.offset,
      end,
      limits: head.limits,
      work,
      remainingBytes,
      readBudget,
    });
    if (!frame) return false;
    if (frame.request.epoch !== head.epoch || frame.request.sequence !== next.sequence + 1)
      throw new CommittedJournalDamage("Journal sequence or epoch mismatch");
    const cursor = { ...next };
    next.offset += frame.bytes;
    next.sequence += 1;
    page.bytes += frame.bytes;
    records.push({ ...frame, cursor, end: { ...next } });
  }
  return true;
}

async function readPartition({ root, head, page, work, readBudget, verifyCursor, entry }) {
  const { next } = page;
  const end = entry.committedBytes;
  requirePartitionPosition(next, entry);
  if (verifyCursor && next.offset !== end) {
    const sequence = next.sequence + 1;
    const offset =
      sequence === entry.firstSequence
        ? 0
        : await readJournalOffset({ root, entry, sequence, work, readBudget });
    if (next.offset !== offset) throw new TypeError("Journal cursor is not a record boundary");
  }
  if (next.offset === end) {
    advancePartition(head, next, end);
    return true;
  }
  const handle = await openCommittedJournalFile(journalPartitionPath(root, next.partition), "body");
  work.partitionOpens += 1;
  return withStorageCleanup(
    async () => {
      const canContinue = await readPartitionRecords(handle, {
        head,
        page,
        end,
        work,
        readBudget,
        byteLimit: head.limits.pageBytes,
        recordLimit: head.limits.pageRecords,
      });
      requirePartitionPosition(next, entry);
      return canContinue;
    },
    () => handle.close(),
  );
}

function requirePartitionPosition(cursor, { firstSequence, lastSequence, committedBytes }) {
  if (
    cursor.offset > committedBytes ||
    cursor.sequence < firstSequence - 1 ||
    cursor.sequence > lastSequence ||
    (cursor.offset === committedBytes) !== (cursor.sequence === lastSequence)
  )
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid journal partition extent");
}

async function readPage({ root, head, cursor, work, partition, readBudget, locatedEntry = null }) {
  requireReadCursor(head, cursor);
  const page = { records: [], next: { ...cursor }, bytes: 0 };
  let entry = locatedEntry;
  let verifyCursor = entry === null;
  while (page.next.sequence < head.sequence && page.records.length < head.limits.pageRecords) {
    if (partition !== null && page.next.partition !== partition) break;
    entry ??= await readPartitionEntry({
      root,
      head,
      partition: page.next.partition,
      work,
      readBudget,
    });
    if (!(await readPartition({ root, head, page, work, readBudget, verifyCursor, entry }))) break;
    if (page.next.partition !== entry.partition) entry = null;
    verifyCursor = false;
  }
  return {
    ...page,
    done:
      page.next.sequence === head.sequence ||
      (partition !== null && page.next.partition !== partition),
  };
}

export async function readJournalPage(root, head, cursor, work) {
  return readPage({ root, head, cursor, work, partition: null });
}

export async function readJournalSequencePage(root, head, sequence, work) {
  const entry = await findSequencePartition(root, head, sequence, work);
  const offset = await readJournalOffset({ root, entry, sequence, work });
  const cursor = { partition: entry.partition, offset, sequence: sequence - 1 };
  return readPage({ root, head, cursor, work, partition: null, locatedEntry: entry });
}

export async function readJournalPartitionPage({ root, head, cursor, work, readBudget }) {
  return readPage({ root, head, cursor, work, partition: cursor.partition, readBudget });
}

function requireMatchingCursor(actual, expected) {
  if (
    actual.sequence !== expected.sequence ||
    actual.partition !== expected.partition ||
    actual.offset !== expected.offset
  )
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Journal tail boundary mismatch");
}

export async function readJournalReceipt(root, head, location, work) {
  const { cursor, end, sequence, bytes } = location;
  const handle = await openCommittedJournalFile(
    journalPartitionPath(root, cursor.partition),
    "body",
  );
  work.partitionOpens += 1;
  return withStorageCleanup(
    async () => {
      const frame = await readJournalFrame(handle, {
        publication: head.publication,
        offset: cursor.offset,
        end: end.offset,
        limits: head.limits,
        work,
        remainingBytes: bytes,
      });
      if (
        frame?.bytes !== bytes ||
        frame.request.epoch !== head.epoch ||
        frame.request.sequence !== sequence
      )
        throw partitionJournalError(
          "SESSION_STORAGE_CORRUPT",
          "Retry receipt disagrees with its journal location",
        );
      return { ...location, digest: frame.digest, payload: frame.request.payload };
    },
    () => handle.close(),
  );
}

function appendReceiptLocations(offsets, { next, receipts, committedBytes, transactionBytes }) {
  for (const [index, offset] of offsets.entries()) {
    const endOffset = index + 1 === offsets.length ? committedBytes : offsets[index + 1];
    const bytes = endOffset - offset;
    if (
      offset !== next.offset ||
      endOffset > committedBytes ||
      bytes <= PARTITION_JOURNAL_FRAME.headerBytes + PARTITION_JOURNAL_FRAME.trailer.length ||
      bytes > transactionBytes
    )
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid retry window offsets");
    const cursor = { ...next };
    next.offset = endOffset;
    next.sequence += 1;
    receipts.push({ sequence: next.sequence, bytes, cursor, end: { ...next } });
  }
}

async function recoverReceiptPartition({ root, head, next, receipts, work, remaining }) {
  const entry = await readPartitionEntry({ root, head, partition: next.partition, work });
  requirePartitionPosition(next, entry);
  if (next.offset < entry.committedBytes) {
    const count = entry.lastSequence - next.sequence;
    remaining -= entry.committedBytes - next.offset;
    if (remaining < 0 || count > head.limits.receiptRecords - receipts.length)
      throw retryWindowBudgetError();
    const offsets = await readJournalOffsets({
      root,
      entry,
      sequence: next.sequence + 1,
      count,
      work,
    });
    appendReceiptLocations(offsets, {
      next,
      receipts,
      committedBytes: entry.committedBytes,
      transactionBytes: head.limits.transactionBytes,
    });
  }
  if (next.sequence < head.sequence) advancePartition(head, next, entry.committedBytes);
  return remaining;
}

export async function recoverJournalReceiptLocations(root, head, work, cached) {
  const receipts = cached.filter(({ sequence }) => sequence > head.receiptStart.sequence);
  let cursor = { ...head.receiptStart };
  if (receipts.length) {
    const first = receipts[0].cursor;
    if (
      first.sequence !== cursor.sequence ||
      first.partition !== cursor.partition ||
      first.offset !== cursor.offset
    )
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Retry window prefix changed");
    cursor = { ...receipts.at(-1).end };
  }
  let remaining =
    head.limits.receiptBytes - receipts.reduce((total, receipt) => total + receipt.bytes, 0);
  if (remaining < 0) throw retryWindowBudgetError();

  const next = { ...cursor };
  while (next.sequence < head.sequence)
    remaining = await recoverReceiptPartition({ root, head, next, receipts, work, remaining });
  requireMatchingCursor(next, head.tail);
  return receipts;
}
