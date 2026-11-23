/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import {
  PARTITION_JOURNAL_FRAME,
  partitionEntityUnpublishedSegmentBudget,
  partitionJournalError,
} from "@noobot/session-protocol/partition-journal";
import { fsRm, fsStat } from "../../shared/storage/fs-adapter.js";
import { syncStorageDirectory } from "../../shared/storage/durable-file.js";
import { journalCatalogDirectory, journalPartitionPath, restoreDurableTail } from "./journal-io.js";
import { journalOffsetsPath } from "./journal-offsets.js";
import { entityDirectoryPath } from "./entity-directory-io.js";
import { discardJournalFileStage } from "./journal-file-publication.js";
import { journalDirectoryPath } from "./journal-directory.js";

async function syncExistingDirectory(directory) {
  try {
    await fsStat(directory);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  await syncStorageDirectory(directory);
}

async function exists(file) {
  try {
    await fsStat(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function discardEntityDirectorySuffix(root, head) {
  const { segment, offset } = head.entityDirectory;
  await restoreDurableTail(entityDirectoryPath(root, segment), offset, "entity directory segment");

  const first = segment + (offset > 0 ? 1 : 0);
  const end = segment + partitionEntityUnpublishedSegmentBudget(head) + 1;
  let next = first;
  while (next < end && (await exists(entityDirectoryPath(root, next)))) next += 1;
  if (next === end && (await exists(entityDirectoryPath(root, next))))
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Unpublished entity directory exceeds its recoverable segment budget",
    );

  for (let last = next - 1; last >= first; last -= 1) {
    await fsRm(entityDirectoryPath(root, last));
    await syncStorageDirectory(journalCatalogDirectory(root));
  }
  await syncExistingDirectory(journalCatalogDirectory(root));
}

export async function restorePublishedPartitionTail(root, head) {
  await restoreDurableTail(
    journalPartitionPath(root, head.tail.partition),
    head.tail.offset,
    "body",
  );
  await restoreDurableTail(
    journalOffsetsPath(root, head.tail.partition),
    head.partitionRecords * PARTITION_JOURNAL_FRAME.offsetBytes,
    "index",
  );
}

export async function discardUnpublishedSuffix(root, head) {
  await discardEntityDirectorySuffix(root, head);
  await restorePublishedPartitionTail(root, head);
  if (head.tail.offset > 0)
    await discardJournalFileStage(journalDirectoryPath(root, head.tail.partition));
  const parents = new Set();
  const first = head.tail.offset === 0 ? 0 : 1;
  const last = Math.min(
    head.limits.batchRecords,
    head.limits.quotaPartitions - head.tail.partition - 1,
  );
  for (let ahead = first; ahead <= last; ahead += 1) {
    const directory = path.dirname(journalPartitionPath(root, head.tail.partition + ahead));
    await fsRm(directory, { recursive: true, force: true });
    parents.add(path.dirname(directory));
  }
  for (const directory of parents) await syncExistingDirectory(directory);
}
