/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { filePath as path } from "@noobot/path-resolver";
import { isFunction } from "@noobot/shared/value";
import {
  PARTITION_JOURNAL_FRAME,
  PARTITION_JOURNAL_PUBLICATION_LOCK,
  PARTITION_SNAPSHOT_FORMAT,
  assertCurrentPartitionJournalPublication,
  capturePartitionJournalSnapshot,
  decodePartitionJournalControl,
  encodePartitionJournalControl,
  partitionJournalError,
  partitionSnapshotFailure,
  requirePartitionSnapshotRecord,
} from "@noobot/session-protocol/partition-journal";
import { sessionPageSnapshotError } from "@noobot/session-protocol/message-read-budget";
import { fsOpen, fsRm, fsStat } from "../../shared/storage/fs-adapter.js";
import { withJournalPublicationLock, withJournalRemovalLock } from "./journal-publication-lock.js";
import {
  assertSnapshotOwnersDrained,
  tryLockSnapshotOwner,
} from "./journal-retention-ownership.js";
import { syncStorageDirectory, withStorageCleanup } from "../../shared/storage/durable-file.js";
import { discardJournalFileStage, replaceJournalFile } from "./journal-file-publication.js";
import {
  journalRetentionsDirectory,
  prepareJournalDirectory,
  readJournalBytes,
  readJournalHead,
} from "./journal-io.js";

const capabilities = new Map();
const unclaimedReleases = new WeakMap();
const reads = new AsyncLocalStorage();

function snapshotPath(journal, slot) {
  return path.join(journalRetentionsDirectory(journal.root), `${slot}.json`);
}

export async function recoverSnapshotRetentions(journal, head) {
  const directory = journalRetentionsDirectory(journal.root);
  try {
    await fsStat(directory);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (let slot = 0; slot < head.limits.retentionRecords; slot += 1)
    await discardJournalFileStage(snapshotPath(journal, slot));
  await removeAbandonedRetentions(journal, head);
  await syncStorageDirectory(directory);
}

async function readSnapshotSlot(journal, head, slot, decode = decodePartitionJournalControl) {
  let handle;
  try {
    handle = await fsOpen(snapshotPath(journal, slot), "r");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return withStorageCleanup(
    async () => {
      try {
        const { size } = await handle.stat();
        if (size > PARTITION_JOURNAL_FRAME.controlBytes)
          throw new RangeError("Snapshot retention exceeds its reserved size");
        const bytes = await readJournalBytes(handle, {
          length: size,
          offset: 0,
          work: journal.work,
        });
        return requirePartitionSnapshotRecord(decode(bytes.toString("utf8")), head, slot);
      } catch (cause) {
        throw Object.assign(
          partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid durable snapshot retention"),
          { cause },
        );
      }
    },
    () => handle.close(),
  );
}

async function removeAbandonedRetentions(journal, head, decode) {
  let liveReaders = 0;
  for (let slot = 0; slot < head.limits.retentionRecords; slot += 1) {
    const record = await readSnapshotSlot(journal, head, slot, decode);
    if (record === null) continue;
    const owner = await tryLockSnapshotOwner(journal, slot, { slotHasRetention: true });
    if (owner === null) {
      liveReaders += 1;
      continue;
    }
    await withStorageCleanup(
      async () => {
        await fsRm(snapshotPath(journal, slot));
        await syncStorageDirectory(path.dirname(snapshotPath(journal, slot)));
      },
      () => owner.close(),
    );
  }
  return liveReaders;
}

export async function drainJournalRetentions(journal, head, decode) {
  if (await removeAbandonedRetentions(journal, head, decode))
    throw partitionJournalError("SESSION_MUTATION_BUSY", "Journal readers must drain");
}

export function withUnretainedJournal(root, operation, { residentJournal, sessionDir } = {}) {
  const lockPath = path.join(root, PARTITION_JOURNAL_PUBLICATION_LOCK);
  const remove = async () => {
    if (residentJournal) await relinquishUnclaimedSnapshots(residentJournal);
    await assertSnapshotOwnersDrained(root);
    return operation();
  };
  return sessionDir
    ? withJournalRemovalLock(sessionDir, lockPath, remove)
    : withJournalPublicationLock(lockPath, remove);
}

export async function acquireJournalSnapshot(journal) {
  await retryUnclaimedSnapshotReleases(journal);
  let snapshot;
  try {
    const retained = await withJournalPublicationLock(journal.lockPath, async () => {
      const head = capturePartitionJournalSnapshot(
        await readJournalHead(journal.root, journal.work),
      );
      if (head.sessionId !== journal.head.sessionId || head.epoch !== journal.head.epoch)
        throw partitionJournalError("SESSION_STORAGE_IDENTITY", "Journal identity changed");
      const directory = journalRetentionsDirectory(journal.root);
      await prepareJournalDirectory(journal.root, directory);
      let slot = 0;
      let owner;
      for (; slot < head.limits.retentionRecords; slot += 1) {
        const previous = await readSnapshotSlot(journal, head, slot);
        owner = await tryLockSnapshotOwner(journal, slot, { slotHasRetention: previous !== null });
        if (owner !== null) break;
      }
      if (slot === head.limits.retentionRecords) throw sessionPageSnapshotError("capacity");
      try {
        await syncStorageDirectory(directory);
        const record = requirePartitionSnapshotRecord(
          {
            format: PARTITION_SNAPSHOT_FORMAT,
            token: randomBytes(16).toString("hex"),
            slot,
            head,
          },
          head,
          slot,
        );
        const bytes = Buffer.from(encodePartitionJournalControl(record));
        if (bytes.length > PARTITION_JOURNAL_FRAME.controlBytes)
          throw partitionJournalError(
            "SESSION_SNAPSHOT_BUDGET",
            "Snapshot exceeds its reserved size",
          );

        const capability = {
          root: journal.root,
          slot,
          token: record.token,
          active: 0,
          closing: true,
          released: false,
          removed: false,
          uncertain: true,
          draining: [],
          release: null,
          owner,
        };
        capabilities.set(head, capability);
        snapshot = head;
        try {
          await replaceJournalFile(snapshotPath(journal, slot), bytes);
        } catch (error) {
          return withStorageCleanup(
            async () => {
              throw error;
            },
            async () => {
              const published = await readSnapshotSlot(journal, head, slot);
              if (published?.token !== record.token) {
                capability.removed = true;
                await owner.close();
                capability.owner = null;
              }
            },
          );
        }
        journal.work.controlWriteBytes += bytes.length;
        return head;
      } catch (error) {
        if (!snapshot)
          return withStorageCleanup(
            async () => {
              throw error;
            },
            () => owner.close(),
          );
        throw error;
      }
    });
    const capability = capabilities.get(retained);
    capability.uncertain = false;
    capability.closing = false;
    return retained;
  } catch (cause) {
    if (!snapshot) throw cause;
    throw partitionSnapshotFailure("acquire", cause, snapshot);
  }
}

export async function withLockedJournalSnapshot(journal, head, operation) {
  const snapshot = capturePartitionJournalSnapshot(head);
  const capability = { root: journal.root, active: 0, closing: false, draining: [] };
  capabilities.set(snapshot, capability);
  try {
    return await withJournalSnapshot(journal, snapshot, () => operation(snapshot));
  } finally {
    capability.closing = true;
    if (capability.active) await new Promise((resolve) => capability.draining.push(resolve));
    capabilities.delete(snapshot);
  }
}

function requireCapability(journal, snapshot) {
  if (snapshot?.sessionId !== journal.head.sessionId || snapshot?.epoch !== journal.head.epoch)
    throw partitionJournalError("SESSION_STORAGE_IDENTITY", "Snapshot belongs to another journal");
  const capability = capabilities.get(snapshot);
  if (!capability || capability.root !== journal.root || capability.released)
    throw partitionJournalError(
      "SESSION_SNAPSHOT_RELEASED",
      "A live retained snapshot is required",
    );
  return capability;
}

export function requireRetainedJournalSnapshotId(journal, snapshot) {
  const capability = requireCapability(journal, snapshot);
  if (capability.slot === undefined || capability.uncertain)
    throw partitionJournalError(
      "SESSION_SNAPSHOT_IN_USE",
      "A published reader snapshot is required",
    );
  return capability.token;
}

function finishSnapshotRead(capability, lease) {
  lease.active = false;
  capability.active -= 1;
  if (capability.active) return;
  for (const resolve of capability.draining.splice(0)) resolve();
}

export async function withJournalSnapshot(journal, snapshot, operation) {
  const capability = requireCapability(journal, snapshot);
  const inherited = reads.getStore();
  if (capability.closing && !inherited?.get(snapshot)?.active)
    throw partitionJournalError("SESSION_SNAPSHOT_RELEASED", "Snapshot is being released");
  const lease = { active: true };
  const scope = new Map(inherited);
  scope.set(snapshot, lease);
  capability.active += 1;
  try {
    return await reads.run(scope, operation);
  } finally {
    finishSnapshotRead(capability, lease);
  }
}

export function withCurrentJournalSnapshot(journal, snapshot, operation) {
  return withJournalSnapshot(journal, snapshot, () =>
    withJournalPublicationLock(journal.lockPath, async () => {
      const head = await readJournalHead(journal.root, journal.work);
      assertCurrentPartitionJournalPublication(head, snapshot);
      return operation();
    }),
  );
}

export async function usingJournalSnapshot(journal, operation) {
  if (!isFunction(operation)) throw new TypeError("Snapshot operation is required");
  let snapshot;
  return withStorageCleanup(
    async () => {
      try {
        snapshot = await acquireJournalSnapshot(journal);
      } catch (error) {
        if (error.code === "SESSION_SNAPSHOT_UNCERTAIN") snapshot = error.snapshot;
        throw error;
      }
      return withJournalSnapshot(journal, snapshot, () => operation(snapshot));
    },
    async () => {
      if (snapshot) await releaseUnclaimedJournalSnapshot(journal, snapshot);
    },
  ).catch((cause) => {
    if (!snapshot || !capabilities.has(snapshot)) throw cause;
    throw partitionSnapshotFailure("release", cause, snapshot);
  });
}

export async function releaseUnclaimedJournalSnapshot(journal, snapshot) {
  const capability = requireCapability(journal, snapshot);
  try {
    await journal.releaseSnapshot(snapshot);
  } catch (cause) {
    if (!unclaimedReleases.has(journal)) unclaimedReleases.set(journal, new Set());
    const pending = unclaimedReleases.get(journal);
    pending.add(snapshot);
    capability.unclaimedReleases = pending;
    throw cause;
  }
}

async function closeSnapshotOwner(capability) {
  if (capability.owner === null) return;
  await capability.owner.close();
  capability.owner = null;
}

function finishSnapshotRelease(snapshot, capability) {
  capability.released = true;
  capability.unclaimedReleases?.delete(snapshot);
  capabilities.delete(snapshot);
}

async function relinquishUnclaimedSnapshots(journal) {
  const pending = unclaimedReleases.get(journal);
  if (!pending) return;
  for (const snapshot of pending) {
    const capability = requireCapability(journal, snapshot);
    if (capability.active || capability.release)
      throw partitionJournalError("SESSION_MUTATION_BUSY", "Snapshot cleanup must drain");
    capability.closing = true;

    try {
      await closeSnapshotOwner(capability);
    } catch (cause) {
      throw partitionSnapshotFailure("release", cause, snapshot);
    }
    finishSnapshotRelease(snapshot, capability);
  }
}

export async function retryUnclaimedSnapshotReleases(journal) {
  const pending = unclaimedReleases.get(journal);
  if (!pending) return;
  for (const snapshot of pending) {
    try {
      await journal.releaseSnapshot(snapshot);
    } catch (cause) {
      throw partitionSnapshotFailure("release", cause, snapshot);
    }
  }
}

async function removeSnapshotSlot(journal, head, capability) {
  const record = await readSnapshotSlot(journal, head, capability.slot);
  if (record !== null && record.token !== capability.token && !capability.uncertain)
    throw partitionJournalError("SESSION_STORAGE_IDENTITY", "Snapshot slot was replaced");

  if (record?.token === capability.token) await fsRm(snapshotPath(journal, capability.slot));
  capability.removed = true;
}

async function releaseRetentionSlot(journal, snapshot, capability) {
  const head = await readJournalHead(journal.root, journal.work);
  if (head.sessionId !== snapshot.sessionId || head.epoch !== snapshot.epoch)
    throw partitionJournalError("SESSION_STORAGE_IDENTITY", "Journal identity changed");

  if (!capability.removed) await removeSnapshotSlot(journal, head, capability);
  await syncStorageDirectory(path.dirname(snapshotPath(journal, capability.slot)));
}

export async function releaseJournalSnapshot(journal, snapshot) {
  const capability = requireCapability(journal, snapshot);
  if (capability.slot === undefined)
    throw partitionJournalError("SESSION_SNAPSHOT_IN_USE", "The writer owns this snapshot");
  if (reads.getStore()?.get(snapshot)?.active)
    throw partitionJournalError(
      "SESSION_SNAPSHOT_IN_USE",
      "Cannot release a snapshot from its own read operation",
    );
  if (capability.release) return capability.release;
  capability.closing = true;
  capability.release = (async () => {
    if (capability.active) await new Promise((resolve) => capability.draining.push(resolve));
    await withJournalPublicationLock(journal.lockPath, async () => {
      await releaseRetentionSlot(journal, snapshot, capability);
      await closeSnapshotOwner(capability);
    });
    finishSnapshotRelease(snapshot, capability);
  })();
  try {
    await capability.release;
  } catch (error) {
    capability.release = null;
    throw error;
  }
}
