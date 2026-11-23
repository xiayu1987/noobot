/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import {
  EMPTY_SEALED_COLLECTION,
  PARTITION_JOURNAL_FRAME,
  decodePartitionJournalDirectory,
  encodePartitionJournalDirectory,
  requireCapturedPartitionJournalSnapshot,
  requirePartitionJournalDirectory,
} from "@noobot/session-protocol/partition-journal";
import { replaceJournalFile } from "./journal-file-publication.js";
import { withStorageCleanup } from "../../shared/storage/durable-file.js";
import {
  CommittedJournalDamage,
  journalPartitionPath,
  openCommittedJournalFile,
  readJournalBytes,
} from "./journal-io.js";

const snapshotDirectories = new WeakMap();

function snapshotDirectoryCache(head) {
  let directories = snapshotDirectories.get(head);
  if (!directories) snapshotDirectories.set(head, (directories = new Map()));
  return directories;
}

export function journalDirectoryPath(root, partition) {
  return path.join(path.dirname(journalPartitionPath(root, partition)), "START");
}

export async function publishPartitionDirectory({
  root,
  head,
  partition,
  firstSequence,
  lastSequence,
  committedBytes,
  collectionRoot,
  work,
}) {
  const entry = requirePartitionJournalDirectory(
    { epoch: head.epoch, partition, firstSequence, lastSequence, committedBytes, collectionRoot },
    head,
    partition,
  );
  const bytes = Buffer.from(encodePartitionJournalDirectory(entry));
  if (bytes.length > PARTITION_JOURNAL_FRAME.directoryBytes)
    throw new RangeError("Partition directory exceeds protocol budget");
  await replaceJournalFile(journalDirectoryPath(root, partition), bytes);
  work.controlWriteBytes += bytes.length;
}

function decodeSealedPartitionEntry(bytes, head, partition) {
  try {
    return requirePartitionJournalDirectory(
      decodePartitionJournalDirectory(bytes.toString("utf8")),
      head,
      partition,
    );
  } catch (cause) {
    throw new CommittedJournalDamage("Invalid partition directory", { cause });
  }
}

async function readSealedPartitionEntry({ root, head, partition, work, readBudget }) {
  const handle = await openCommittedJournalFile(journalDirectoryPath(root, partition), "directory");
  return withStorageCleanup(
    async () => {
      const { size } = await handle.stat();
      if (size > PARTITION_JOURNAL_FRAME.directoryBytes)
        throw new CommittedJournalDamage("Partition directory exceeds protocol budget");
      const bytes = await readJournalBytes(handle, { length: size, offset: 0, work, readBudget });
      const entry = decodeSealedPartitionEntry(bytes, head, partition);
      return entry.collectionRoot === EMPTY_SEALED_COLLECTION
        ? { ...entry, collectionRoot: null }
        : entry;
    },
    () => handle.close(),
  );
}

export function activePartitionEntry(head) {
  return {
    epoch: head.epoch,
    partition: head.tail.partition,
    firstSequence: head.sequence - head.partitionRecords + 1,
    lastSequence: head.sequence,
    committedBytes: head.tail.offset,
    collectionRoot: head.entityDirectory.activeCollection,
  };
}

export async function readPartitionEntry({ root, head, partition, work, readBudget }) {
  if (partition === head.tail.partition) return activePartitionEntry(head);
  const cache = snapshotDirectoryCache(head);
  const key = journalDirectoryPath(root, partition);
  if (cache.has(key)) return structuredClone(cache.get(key));
  const entry = await readSealedPartitionEntry({ root, head, partition, work, readBudget });
  cache.set(key, structuredClone(entry));
  if (cache.size > head.limits.pageRecords) cache.delete(cache.keys().next().value);
  return entry;
}

export async function findSequencePartition(root, head, sequence, work) {
  requireCapturedPartitionJournalSnapshot(head);
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > head.sequence)
    throw new RangeError("Requested sequence is outside snapshot");
  const active = activePartitionEntry(head);
  if (sequence >= active.firstSequence) return active;
  let low = 0;
  let high = head.tail.partition - 1;
  while (low <= high) {
    const partition = low + Math.floor((high - low) / 2);
    const entry = await readPartitionEntry({ root, head, partition, work });
    if (sequence < entry.firstSequence) high = partition - 1;
    else if (sequence > entry.lastSequence) low = partition + 1;
    else return entry;
  }
  throw new CommittedJournalDamage("Committed sequence has no partition");
}
