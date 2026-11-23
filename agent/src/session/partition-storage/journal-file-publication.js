/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createDurableFilePublisher,
  syncStorageDirectory,
} from "../../shared/storage/durable-file.js";
import { fsRm } from "../../shared/storage/fs-adapter.js";
import { filePath as path } from "@noobot/path-resolver";

const journalStage = (target) => `${target}.publish.tmp`;
const publisher = createDurableFilePublisher(journalStage, { exclusiveStage: true });

export async function discardJournalFileStage(target) {
  try {
    await fsRm(journalStage(target));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  await syncStorageDirectory(path.dirname(target));
}

export const installJournalFile = publisher.writeDurableNewFile;

export async function replaceJournalFile(target, bytes, beforeRename, directorySyncError) {
  await publisher.replaceSyncedFile(target, bytes, beforeRename);
  try {
    await syncStorageDirectory(path.dirname(target));
  } catch (cause) {
    throw directorySyncError ? directorySyncError(cause) : cause;
  }
}
