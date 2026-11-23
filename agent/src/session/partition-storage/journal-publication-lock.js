/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { acquireDescriptorLock } from "@noobot/platform-compatibility/descriptor-lock";
import { fsOpen } from "../../shared/storage/fs-adapter.js";
import { syncStorageDirectory, withStorageCleanup } from "../../shared/storage/durable-file.js";

export async function initializeJournalPublicationLock(root, lockPath) {
  const handle = await fsOpen(lockPath, "a+", 0o600);
  await withStorageCleanup(
    () => handle.sync(),
    () => handle.close(),
  );
  await syncStorageDirectory(root);
}

async function openJournalPublicationLock(lockPath) {
  try {
    return await fsOpen(lockPath, "r+");
  } catch (cause) {
    if (cause.code !== "ENOENT") throw cause;
    throw Object.assign(
      partitionJournalError("SESSION_STORAGE_CORRUPT", "Journal publication lock is missing"),
      { cause },
    );
  }
}

export async function withJournalPublicationLock(lockPath, operation) {
  const { lockPollIntervalMs, lockTimeoutMs } = TIME_THRESHOLDS.fileMutation;
  const handle = await openJournalPublicationLock(lockPath);
  return withStorageCleanup(
    async () => {
      await acquireDescriptorLock(handle, {
        deadline: performance.now() + lockTimeoutMs,
        pollMs: lockPollIntervalMs,
        timeoutError: () =>
          partitionJournalError("SESSION_MUTATION_BUSY", "Journal publication lock is busy"),
      });
      return operation();
    },
    () => handle.close(),
  );
}
