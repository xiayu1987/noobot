/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createReadStream } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { filePath as path } from "@noobot/path-resolver";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import {
  assertPartitionSessionJournalPolicy,
  decodePartitionJournalControl,
  encodePartitionJournalControl,
  PARTITION_JOURNAL_DIRECTORIES,
  PARTITION_JOURNAL_FORMAT,
  PARTITION_JOURNAL_FRAME,
  PARTITION_JOURNAL_PUBLICATION_LOCK,
  partitionJournalError,
  requirePartitionJournalHead,
  requirePartitionSessionStorageBudget,
} from "@noobot/session-protocol/partition-journal";
import {
  PARTITION_MIGRATION_AUTHORITY,
  readPartitionAuthorityPublication,
  requirePartitionSessionAuthority,
} from "@noobot/session-protocol/session-reader";
import { readFilePrefix } from "@noobot/shared/read-file-prefix";
import {
  createDurableFilePublisher,
  ensureDurableStorageDirectory,
  syncStorageDirectory,
} from "../shared/storage/durable-file.js";
import { fsLstat, fsOpen, fsReaddir, fsRm } from "../shared/storage/fs-adapter.js";
import {
  partitionMigrationRoot,
  readSessionStorageAuthority,
  withSessionStorageAuthorityLock,
} from "../session/session-storage-authority.js";
import {
  initializeJournalPublicationLock,
  withJournalPublicationLock,
} from "../session/partition-storage/journal-publication-lock.js";
import {
  discardUnpublishedJournalHead,
  publishJournalHead,
  readJournalHead,
} from "../session/partition-storage/journal-io.js";
import { drainJournalRetentions } from "../session/partition-storage/journal-snapshots.js";
import { PartitionJournal } from "../session/partition-storage/partition-journal.js";
import { discoverMigrationSessions } from "./migrate-workspace-sessions-to-partition.js";
import { assertWorkspaceQuarantineEmpty } from "./migration-quarantine.js";
import { upgradePartitionFormatTitles } from "./partition-format-title-upgrade.js";

const LEGACY_FORMAT = "noobot.partition-journal-prototype/93";
const STAGE = `.format-v47${PARTITION_MIGRATION_AUTHORITY.scratchSuffix}`;
const JOURNAL_DATA_DIRECTORIES = [
  PARTITION_JOURNAL_DIRECTORIES.partitions,
  PARTITION_JOURNAL_DIRECTORIES.catalog,
];
const publisher = createDurableFilePublisher((file) => `${file}.format-upgrade.tmp`, {
  exclusiveStage: true,
});

function requireUpgradeHead(head) {
  if (head.format === LEGACY_FORMAT)
    return requirePartitionJournalHead({ ...head, format: PARTITION_JOURNAL_FORMAT });
  return requirePartitionJournalHead(head);
}

function readUpgradeHead(root) {
  return readJournalHead(root, { readBytes: 0 }, (bytes) => {
    const source = decodePartitionJournalControl(bytes.toString("utf8"));
    requireUpgradeHead(source);
    return source;
  });
}

function decodeLegacyRetention(serialized) {
  const record = decodePartitionJournalControl(serialized);
  return { ...record, head: requireUpgradeHead(record.head) };
}

async function listJournalDirectory(directory) {
  try {
    if (!(await fsLstat(directory)).isDirectory())
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid journal directory");
    return await fsReaddir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
}

async function copyJournalFile(from, to, signal) {
  const destination = await fsLstat(to).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (destination && !destination.isFile())
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid journal data target");
  await publisher.publishSyncedFile(to, async (handle) => {
    for await (const chunk of createReadStream(from, { signal })) await handle.writeFile(chunk);
  });
}

async function copyJournalDirectory(source, target, signal) {
  const entries = await listJournalDirectory(source);
  if (entries.length === 0) return;
  await ensureDurableStorageDirectory(target);
  for (const entry of entries) {
    signal?.throwIfAborted();
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) await copyJournalDirectory(from, to, signal);
    else if (entry.isFile() && /^(START|records\.log|offsets\.idx|\d+\.pages)$/.test(entry.name)) {
      await copyJournalFile(from, to, signal);
    } else if (!(entry.isFile() && /\.(publish|format-upgrade)\.tmp$/.test(entry.name))) {
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid journal data entry");
    }
  }
  await syncStorageDirectory(target);
}

async function copyJournalData(source, target, signal) {
  for (const directory of JOURNAL_DATA_DIRECTORIES)
    await copyJournalDirectory(path.join(source, directory), path.join(target, directory), signal);
}

async function readUpgradeReceipt(file) {
  try {
    const maxBytes = PARTITION_JOURNAL_FRAME.controlBytes * 2;
    const bytes = await readFilePrefix(file, maxBytes + 1, fsOpen);
    if (bytes.length > maxBytes)
      throw new RangeError("Partition format upgrade receipt is too large");
    return decodePartitionJournalControl(bytes.toString("utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

function journalPublication(root) {
  return { root, work: { readBytes: 0, controlWriteBytes: 0, publications: 0 } };
}

async function prepareUpgradeStage(root, stage, source, signal) {
  const receiptFile = path.join(stage, "READY");
  const receipt = await readUpgradeReceipt(receiptFile);
  if (receipt !== null) {
    const target = await readJournalHead(stage, { readBytes: 0 });
    if (!isDeepStrictEqual(source, receipt.source) || !isDeepStrictEqual(target, receipt.target))
      throw partitionJournalError(
        "SESSION_STORAGE_UPGRADE_BLOCKED",
        "Partition format upgrade stage disagrees with journal",
      );
    return target;
  }

  await fsRm(stage, { recursive: true, force: true });
  await ensureDurableStorageDirectory(stage);
  await copyJournalData(root, stage, signal);
  await initializeJournalPublicationLock(
    stage,
    path.join(stage, PARTITION_JOURNAL_PUBLICATION_LOCK),
  );
  await publishJournalHead(journalPublication(stage), requireUpgradeHead(source));
  const journal = await PartitionJournal.open({ root: stage, sessionId: source.sessionId });
  try {
    await upgradePartitionFormatTitles(journal, signal);
  } finally {
    await journal.close();
  }
  signal?.throwIfAborted();
  const target = journal.head;
  await publisher.writeDurableReplacement(
    receiptFile,
    encodePartitionJournalControl({ source, target }),
  );
  return target;
}

async function upgradeJournalFormat(root, stage, source, signal) {
  const normalized = requireUpgradeHead(source);
  await drainJournalRetentions(journalPublication(root), normalized, decodeLegacyRetention);
  const target = await prepareUpgradeStage(root, stage, source, signal);

  await copyJournalData(stage, root, signal);
  signal?.throwIfAborted();
  await discardUnpublishedJournalHead(root);
  await publishJournalHead(journalPublication(root), target);
}

async function upgradeSessionFormat(sessionDir, limits, signal) {
  return withSessionStorageAuthorityLock(sessionDir, async () => {
    const facts = await readSessionStorageAuthority(sessionDir);
    if (!requirePartitionSessionAuthority(facts))
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Partition storage authority disappeared",
      );
    const { migration } = facts;
    const root = migration === undefined ? sessionDir : partitionMigrationRoot(sessionDir);
    const stage = path.join(root, STAGE);
    return withJournalPublicationLock(
      path.join(root, PARTITION_JOURNAL_PUBLICATION_LOCK),
      async () => {
        const { head } = await readPartitionAuthorityPublication(migration, () =>
          readUpgradeHead(root),
        );
        assertPartitionSessionJournalPolicy(head, limits);
        if (head.format === LEGACY_FORMAT) await upgradeJournalFormat(root, stage, head, signal);
        await syncStorageDirectory(root);
        await fsRm(stage, { recursive: true, force: true });
        await syncStorageDirectory(root);
        return head.format === LEGACY_FORMAT;
      },
    );
  });
}

export async function upgradeWorkspacePartitionFormat({
  base,
  scopedSessionRoots,
  targetStorageBudget,
  signal,
  onSessionProcessed,
}) {
  await assertWorkspaceQuarantineEmpty(base);
  const { journalLimits } = requirePartitionSessionStorageBudget(targetStorageBudget);
  const roots = new Set([WORKSPACE_LAYOUT.SESSION_DIR, ...scopedSessionRoots]);
  const upgraded = [];
  for await (const { sessionDir, authority } of discoverMigrationSessions(base, roots)) {
    signal?.throwIfAborted();
    if (authority !== "partition")
      throw partitionJournalError(
        "SESSION_STORAGE_UPGRADE_BLOCKED",
        "Session requires partition storage before format upgrade",
      );
    if (await upgradeSessionFormat(sessionDir, journalLimits, signal)) upgraded.push(sessionDir);
    onSessionProcessed();
  }
  return { upgraded: upgraded.sort() };
}
