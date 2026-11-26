/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { filePath as path } from "@noobot/path-resolver";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { acquireDescriptorLock } from "@noobot/platform-compatibility/descriptor-lock";
import { fsLink, fsLstat, fsOpen, fsRm } from "../../shared/storage/fs-adapter.js";
import { syncStorageDirectory, withStorageCleanup } from "../../shared/storage/durable-file.js";

export async function initializeJournalPublicationLock(root, lockPath) {
  const handle = await fsOpen(lockPath, "a+", 0o600);
  await withStorageCleanup(
    () => handle.sync(),
    () => handle.close(),
  );
  await syncStorageDirectory(root);
}

async function requireJournalPublicationLock(operation) {
  try {
    return await operation();
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
  const handle = await requireJournalPublicationLock(() => fsOpen(lockPath, "r+"));
  return withStorageCleanup(
    async () => {
      await acquireDescriptorLock(handle, {
        deadline: performance.now() + lockTimeoutMs,
        pollMs: lockPollIntervalMs,
        timeoutError: () =>
          partitionJournalError("SESSION_MUTATION_BUSY", "Journal publication lock is busy"),
      });
      return operation(handle);
    },
    () => handle.close(),
  );
}

export function journalRemovalLockPath(sessionDir) {
  return path.join(path.dirname(sessionDir), `.journal-removal-${path.basename(sessionDir)}.lock`);
}

export async function removeJournalRemovalLock(sessionDir) {
  if (process.platform === "win32") await fsRm(journalRemovalLockPath(sessionDir), { force: true });
}

export async function withJournalRemovalLock(sessionDir, lockPath, operation) {
  if (process.platform !== "win32") return withJournalPublicationLock(lockPath, operation);

  const externalPublicationLockLink = journalRemovalLockPath(sessionDir);
  try {
    await requireJournalPublicationLock(() => fsLink(lockPath, externalPublicationLockLink));
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return withJournalPublicationLock(externalPublicationLockLink, async (handle) => {
    const linked = await handle.stat({ bigint: true });
    const original = await requireJournalPublicationLock(() => fsLstat(lockPath, { bigint: true }));
    if (!original.isFile() || original.dev !== linked.dev || original.ino !== linked.ino)
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Journal removal lock does not match publication lock",
      );
    return operation();
  });
}
