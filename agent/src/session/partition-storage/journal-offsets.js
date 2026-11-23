/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { PARTITION_JOURNAL_FRAME } from "@noobot/session-protocol/partition-journal";
import { fsOpen } from "../../shared/storage/fs-adapter.js";
import { withStorageCleanup } from "../../shared/storage/durable-file.js";
import {
  CommittedJournalDamage,
  clampJournalTail,
  journalPartitionPath,
  openCommittedJournalFile,
  readJournalBytes,
  writeJournalBytes,
} from "./journal-io.js";
import { groupPartitionWrites } from "./journal-write-groups.js";

const { offsetBytes } = PARTITION_JOURNAL_FRAME;

export function journalOffsetsPath(root, partition) {
  return path.join(path.dirname(journalPartitionPath(root, partition)), "offsets.idx");
}

async function writePartitionOffsets(root, { previous, partition, writes, work }) {
  const extending = partition === previous.tail.partition && previous.partitionRecords > 0;
  const committedBytes = extending ? previous.partitionRecords * offsetBytes : 0;
  const file = journalOffsetsPath(root, partition);
  const handle = extending
    ? await openCommittedJournalFile(file, "index", "r+")
    : await fsOpen(file, "w+");
  return withStorageCleanup(
    async () => {
      if (extending) await clampJournalTail(handle, committedBytes);
      const bytes = Buffer.alloc(writes.length * offsetBytes);
      writes.forEach(({ receipt }, index) =>
        bytes.writeBigUInt64BE(BigInt(receipt.cursor.offset), index * offsetBytes),
      );
      await writeJournalBytes(handle, bytes, committedBytes, work);
      await handle.sync();
    },
    () => handle.close(),
  );
}

export async function writeJournalOffsets(root, previous, writes, work) {
  for (const [partition, group] of groupPartitionWrites(writes))
    await writePartitionOffsets(root, { previous, partition, writes: group, work });
}

function decodeCommittedOffsets(bytes, { count, ordinal, committedBytes }) {
  const offsets = [];
  for (let index = 0; index < count; index++) {
    const offset = Number(bytes.readBigUInt64BE(index * offsetBytes));
    if (
      !Number.isSafeInteger(offset) ||
      offset >= committedBytes ||
      (offset === 0) !== (ordinal + index === 0)
    )
      throw new CommittedJournalDamage("Invalid committed partition index offset");
    offsets.push(offset);
  }
  return offsets;
}

export function openJournalOffsetFile(root, partition) {
  return openCommittedJournalFile(journalOffsetsPath(root, partition), "index");
}

async function withJournalOffsetFile(root, partition, operation) {
  const handle = await openJournalOffsetFile(root, partition);
  return withStorageCleanup(
    () => operation(handle),
    () => handle.close(),
  );
}

export async function readJournalOffsets({
  root,
  entry,
  sequence,
  count,
  work,
  readBudget,
  withOffsetFile = withJournalOffsetFile,
}) {
  const ordinal = sequence - entry.firstSequence;
  if (
    ordinal < 0 ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count - 1 > entry.lastSequence - sequence
  )
    throw new RangeError("Sequence exceeds partition index bounds");
  return withOffsetFile(root, entry.partition, async (handle) => {
    const bytes = await readJournalBytes(handle, {
      length: count * offsetBytes,
      offset: ordinal * offsetBytes,
      work,
      readBudget,
    });
    return decodeCommittedOffsets(bytes, { count, ordinal, committedBytes: entry.committedBytes });
  });
}

export async function readJournalOffset(options) {
  const [offset] = await readJournalOffsets({ ...options, count: 1 });
  return offset;
}
