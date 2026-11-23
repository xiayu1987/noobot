/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { tryAcquireDescriptorLock } from "@noobot/platform-compatibility/descriptor-lock";
import {
  PARTITION_JOURNAL_DIRECTORIES,
  PARTITION_SNAPSHOT_OWNERSHIP_DIRECTORY,
  partitionJournalError,
} from "@noobot/session-protocol/partition-journal";
import { fsOpen, fsReaddir } from "../../shared/storage/fs-adapter.js";
import { syncStorageDirectory, withStorageCleanup } from "../../shared/storage/durable-file.js";
import { prepareJournalDirectory } from "./journal-io.js";

async function listOwnershipEntries(directory) {
  try {
    return await fsReaddir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function assertSnapshotOwnersDrained(root) {
  const directory = path.join(root, PARTITION_SNAPSHOT_OWNERSHIP_DIRECTORY);
  const owners = new Set(await listOwnershipEntries(directory));
  const retentions = await listOwnershipEntries(
    path.join(root, PARTITION_JOURNAL_DIRECTORIES.retentions),
  );
  for (const file of retentions) {
    if (file.endsWith(".json") && !owners.has(`${file.slice(0, -5)}.lock`))
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Snapshot ownership lock is missing");
  }
  for (const file of owners) {
    const handle = await fsOpen(path.join(directory, file), "r+");
    await withStorageCleanup(
      async () => {
        if (!(await tryAcquireDescriptorLock(handle)))
          throw partitionJournalError(
            "SESSION_MUTATION_BUSY",
            "Session deletion requires journal readers to drain",
          );
      },
      () => handle.close(),
    );
  }
}

export async function tryLockSnapshotOwner(journal, slot, { slotHasRetention }) {
  const directory = path.join(journal.root, PARTITION_SNAPSHOT_OWNERSHIP_DIRECTORY);
  const file = path.join(directory, `${slot}.lock`);
  let handle;
  let createdSidecar = false;
  try {
    handle = await fsOpen(file, "r+");
  } catch (cause) {
    if (cause.code !== "ENOENT") throw cause;
    if (slotHasRetention)
      throw Object.assign(
        partitionJournalError("SESSION_STORAGE_CORRUPT", "Snapshot ownership lock is missing"),
        { cause },
      );
    await prepareJournalDirectory(journal.root, directory);
    handle = await fsOpen(file, "wx+");
    createdSidecar = true;
  }
  let locked;
  try {
    if (createdSidecar) await handle.sync();
    locked = await tryAcquireDescriptorLock(handle);
    if (locked && !slotHasRetention) await syncStorageDirectory(directory);
  } catch (error) {
    return withStorageCleanup(
      async () => {
        throw error;
      },
      () => handle.close(),
    );
  }
  if (locked) return handle;
  await handle.close();
  return null;
}
