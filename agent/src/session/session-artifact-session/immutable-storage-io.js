/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { hash, randomUUID } from "node:crypto";
import { filePath as path } from "@noobot/path-resolver";
import { renameFileAtomic } from "@noobot/platform-compatibility/atomic-file-write";
import { syncDirectory } from "@noobot/platform-compatibility/file-system";
import { immutablePublicationTemporaryFile } from "@noobot/session-protocol/immutable-storage";
import { fsOpen, fsRename, fsRm } from "../../shared/storage/fs-adapter.js";
import { recordStorageWork } from "./storage-transaction.js";

export function contentDigest(bytes) {
  return hash("sha256", bytes, "hex");
}

export async function withStorageCleanup(operation, cleanup) {
  let failed = false;
  let failure;
  let result;
  try {
    result = await operation();
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    await cleanup();
  } catch (error) {
    if (failed)
      throw new AggregateError([failure, error], "Immutable storage operation and cleanup failed", {
        cause: failure,
      });
    throw error;
  }
  if (failed) throw failure;
  return result;
}

export async function syncStorageDirectory(directory) {
  if (await syncDirectory({ directory, open: fsOpen }))
    recordStorageWork("immutableDirectorySyncs");
}

export async function publishSyncedFile(file, write, syncWork) {
  const temporary = immutablePublicationTemporaryFile(file, randomUUID());
  try {
    const handle = await fsOpen(temporary, "wx");
    await withStorageCleanup(
      async () => {
        await write(handle);
        await handle.sync();
        if (syncWork !== null) recordStorageWork(syncWork);
      },
      () => handle.close(),
    );
    await renameFileAtomic({ source: temporary, filePath: file, rename: fsRename });
  } catch (error) {
    await withStorageCleanup(
      async () => {
        throw error;
      },
      () => fsRm(temporary, { force: true }),
    );
  }
}

export function replaceSyncedFile(file, bytes) {
  return publishSyncedFile(file, (handle) => handle.writeFile(bytes), null);
}

export async function writeDurableReplacement(file, bytes) {
  await replaceSyncedFile(file, Buffer.from(bytes));
  await syncStorageDirectory(path.dirname(file));
}
