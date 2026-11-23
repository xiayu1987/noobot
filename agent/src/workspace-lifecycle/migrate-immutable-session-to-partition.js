/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { captureImmutableMigrationSourceIdentity } from "@noobot/session-protocol/immutable-storage";
import {
  decodePartitionMigrationBusinessCheckpoint,
  encodePartitionMigrationBusinessCheckpoint,
  PARTITION_MIGRATION_AUTHORITY,
  PARTITION_MIGRATION_BUSINESS_CHECKPOINT,
  requirePartitionMigrationBudget,
} from "@noobot/session-protocol/session-reader";
import { PARTITION_SESSION_PUBLICATION } from "@noobot/session-protocol/partition-journal";
import { readFilePrefix } from "@noobot/shared/read-file-prefix";
import { PartitionJournal } from "../session/partition-storage/partition-journal.js";
import { replaceJournalFile } from "../session/partition-storage/journal-file-publication.js";
import {
  partitionMigrationRoot,
  readPartitionMigrationReceipt,
  withSessionStorageAuthorityLock,
} from "../session/session-storage-authority.js";
import { syncStorageDirectory } from "../shared/storage/durable-file.js";
import {
  fsLstat,
  fsMkdir,
  fsOpen,
  fsRealpath,
  fsRename,
  fsRm,
} from "../shared/storage/fs-adapter.js";
import { publishImmutableSessionStaging } from "./publish-immutable-session-staging.js";
import { reconcileImmutableSessionStaging } from "./reconcile-immutable-session-staging.js";

async function hasMigrationDirectory(target) {
  let stat;
  try {
    stat = await fsLstat(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return false;
  }
  if (!stat.isDirectory())
    throw Object.assign(new Error(`Invalid migration staging directory: ${target}`), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  return true;
}

async function removeMigrationScratch(scratch) {
  if (await hasMigrationDirectory(scratch)) await fsRm(scratch, { recursive: true });
  await syncStorageDirectory(path.dirname(scratch));
}

async function readBusinessCheckpoint(file) {
  try {
    const { maxBytes } = PARTITION_MIGRATION_BUSINESS_CHECKPOINT;
    return decodePartitionMigrationBusinessCheckpoint(
      await readFilePrefix(file, maxBytes + 1, fsOpen),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

async function stageMigration(options, scratch, target) {
  const stagingDir = path.join(scratch, "journal");
  const file = path.join(scratch, PARTITION_MIGRATION_BUSINESS_CHECKPOINT.file);
  const checkpoint = (await hasMigrationDirectory(scratch))
    ? await readBusinessCheckpoint(file)
    : null;
  if (checkpoint === null) {
    await removeMigrationScratch(scratch);
    await fsMkdir(scratch, { mode: 0o700 });
    await syncStorageDirectory(path.dirname(scratch));
    const journal = await PartitionJournal.create({
      root: stagingDir,
      durableAncestor: scratch,
      sessionId: options.expectedSource.sessionId,
      limits: options.targetStorageBudget.journalLimits,
      publication: PARTITION_SESSION_PUBLICATION,
    });
    await journal.close();
  } else if (!(await hasMigrationDirectory(stagingDir))) {
    throw Object.assign(new Error("Verified migration staging journal is missing"), {
      code: "SESSION_STORAGE_CORRUPT",
    });
  }
  await reconcileImmutableSessionStaging(
    { ...options, stagingDir },
    {
      checkpoint,
      seal: (record) =>
        replaceJournalFile(file, encodePartitionMigrationBusinessCheckpoint(record)),
    },
  );
  options.signal?.throwIfAborted();
  await fsRename(stagingDir, target);
  await syncStorageDirectory(options.sessionDir);
  await syncStorageDirectory(scratch);
}

export async function migrateImmutableSessionToPartition({
  sessionDir,
  expectedSource,
  targetStorageBudget,
  limit,
  maxBytes,
  signal,
}) {
  const identity = captureImmutableMigrationSourceIdentity(expectedSource);
  const budget = requirePartitionMigrationBudget({ targetStorageBudget, limit, maxBytes });
  signal?.throwIfAborted();
  const source = await fsRealpath(sessionDir);
  const options = {
    sessionDir: source,
    expectedSource: identity,
    targetStorageBudget: budget,
    limit,
    maxBytes,
    signal,
  };
  return withSessionStorageAuthorityLock(source, async () => {
    signal?.throwIfAborted();
    const receipt = await readPartitionMigrationReceipt(source, identity, budget.journalLimits);
    const target = partitionMigrationRoot(source);
    const scratch = `${source}${PARTITION_MIGRATION_AUTHORITY.scratchSuffix}`;
    if (receipt === null && !(await hasMigrationDirectory(target)))
      await stageMigration(options, scratch, target);
    const published = receipt ?? (await publishImmutableSessionStaging(options));
    await removeMigrationScratch(scratch);
    return published;
  });
}
