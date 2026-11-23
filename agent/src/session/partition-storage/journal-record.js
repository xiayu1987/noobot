/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { withStorageCleanup } from "../../shared/storage/durable-file.js";
import {
  partitionJournalError,
  requireCapturedPartitionJournalSnapshot,
  requirePartitionJournalReference,
} from "@noobot/session-protocol/partition-journal";
import { findSequencePartition, readPartitionEntry } from "./journal-directory.js";
import { openJournalOffsetFile, readJournalOffset } from "./journal-offsets.js";
import {
  CommittedJournalDamage,
  journalPartitionPath,
  openCommittedJournalFile,
  readJournalFrame,
  readJournalFrameSlots,
} from "./journal-io.js";

const queryFrames = new WeakMap();
const recordReaders = new AsyncLocalStorage();

const RETAINED_PARTITIONS = 4;

function activeRecordReader(root, head) {
  const reader = recordReaders.getStore();
  return reader && !reader.closed && reader.root === root && reader.head === head ? reader : null;
}

export function withJournalRecordReader(root, head, operation) {
  if (activeRecordReader(root, head) !== null) return operation();
  const reader = { root, head, partitions: new Map(), closed: false };
  return withStorageCleanup(
    () => recordReaders.run(reader, operation),
    async () => {
      reader.closed = true;
      const results = await Promise.allSettled(
        [...reader.partitions.values()].flatMap(({ body, index }) => [
          body?.close(),
          index?.close(),
        ]),
      );
      const failures = results
        .filter(({ status }) => status === "rejected")
        .map(({ reason }) => reason);
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1)
        throw new AggregateError(failures, "Journal record reader close failed");
    },
  );
}

async function openRecordBody(file, work) {
  const handle = await openCommittedJournalFile(file, "body");
  work.partitionOpens += 1;
  return handle;
}

function scopedPartitionReader(root, head, partition) {
  const reader = activeRecordReader(root, head);
  if (reader === null) return null;
  let files = reader.partitions.get(partition);
  if (files !== undefined) return files;
  if (reader.partitions.size === RETAINED_PARTITIONS) return null;
  files = { body: null, index: null };
  reader.partitions.set(partition, files);
  return files;
}

function withRecordBody(file, reader, work, operation) {
  if (!reader) return withUnsharedBody(file, work, operation);
  reader.body ??= reserveRecordFile(openRecordBody(file, work));
  return reader.body.read(operation);
}

async function withUnsharedBody(file, work, operation) {
  const handle = await openRecordBody(file, work);
  return withStorageCleanup(
    () => operation(handle),
    () => handle.close(),
  );
}

function reserveRecordFile(opened) {
  const reads = new Set();
  return {
    async read(operation) {
      const pending = opened.then(operation);
      reads.add(pending);
      try {
        return await pending;
      } finally {
        reads.delete(pending);
      }
    },
    async close() {
      if (reads.size) await Promise.allSettled(reads);

      const handle = await opened.catch(() => null);
      if (handle !== null) await handle.close();
    },
  };
}

function getQueryFrames(readBudget, head) {
  if (!readBudget) return null;
  let snapshots = queryFrames.get(readBudget);
  if (!snapshots) queryFrames.set(readBudget, (snapshots = new WeakMap()));
  let frames = snapshots.get(head);
  if (!frames) snapshots.set(head, (frames = new Map()));
  return frames;
}

export async function readJournalRecord(options) {
  return readReferencedRecord(options);
}

export async function readJournalRecordSlots(options) {
  const { head } = options;
  if (head.publication !== "collections")
    throw partitionJournalError(
      "SESSION_PUBLICATION_CONTRACT",
      "Slots require a collection journal",
    );
  return readReferencedRecord(options);
}

async function readReferencedRecord({ root, head, reference, work, readBudget, slots }) {
  requireCapturedPartitionJournalSnapshot(head);
  requirePartitionJournalReference(reference, head);
  const { partition, sequence } = reference;
  const frames = slots ? getQueryFrames(readBudget?.frameScope ?? readBudget, head) : null;
  const key = `${partition}:${sequence}`;
  const cached = frames?.get(key);
  const entry =
    cached?.entry ?? (await readPartitionEntry({ root, head, partition, work, readBudget }));
  const record = await readRecordInPartition({
    root,
    head,
    entry,
    sequence,
    work,
    readBudget,
    slots,
    cached,
  });
  if (!slots) return record;
  frames?.set(key, { entry, frame: record.frame, offset: record.offset });
  if (frames && frames.size > readBudget.frameLimit) frames.delete(frames.keys().next().value);
  return record.slotRecords;
}

export async function readJournalSequenceRecord({ root, head, sequence, work }) {
  const entry = await findSequencePartition(root, head, sequence, work);
  return readRecordInPartition({ root, head, entry, sequence, work });
}

async function readRecordInPartition({
  root,
  head,
  entry,
  sequence,
  work,
  readBudget,
  slots,
  cached,
}) {
  const { partition } = entry;
  const reader = scopedPartitionReader(root, head, partition);
  const offset =
    cached?.offset ??
    (await readJournalOffset({
      root,
      entry,
      sequence,
      work,
      readBudget,
      withOffsetFile: reader
        ? (journalRoot, partitionId, operation) => {
            reader.index ??= reserveRecordFile(openJournalOffsetFile(journalRoot, partitionId));
            return reader.index.read(operation);
          }
        : undefined,
    }));
  return withRecordBody(journalPartitionPath(root, partition), reader, work, async (handle) => {
    const end = entry.committedBytes;
    const range = {
      offset,
      end,
      limits: head.limits,
      work,
      remainingBytes: head.limits.transactionBytes,
      readBudget,
    };
    const record = slots
      ? await readJournalFrameSlots(handle, {
          range,
          position: { epoch: head.epoch, sequence },
          slots,
          validatedFrame: cached?.frame,
        })
      : await readJournalFrame(handle, { ...range, publication: head.publication });
    if (record === null)
      throw partitionJournalError(
        "SESSION_QUERY_BUDGET",
        "Query exceeds journal frame byte budget",
      );
    if (!slots && (record.request.epoch !== head.epoch || record.request.sequence !== sequence))
      throw new CommittedJournalDamage("Record handle identity mismatch");
    if ((offset + record.bytes === end) !== (sequence === entry.lastSequence))
      throw new CommittedJournalDamage("Record disagrees with partition boundary");
    if (slots) return { ...record, offset };
    return {
      ...record,
      cursor: { partition, offset, sequence: sequence - 1 },
      end: { partition, offset: offset + record.bytes, sequence },
    };
  });
}
