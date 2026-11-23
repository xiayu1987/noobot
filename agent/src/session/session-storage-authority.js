/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import {
  PARTITION_MIGRATION_AUTHORITY,
  partitionMigrationPublicationUncertain,
  readPartitionAuthorityPublication,
  readSessionStorageAuthorityFacts,
  requireImmutableSessionAuthority,
  requirePartitionSessionAuthority,
} from "@noobot/session-protocol/session-reader";
import { bindImmutableMigrationSource } from "@noobot/session-protocol/immutable-storage";
import { assertPartitionSessionJournalPolicy } from "@noobot/session-protocol/partition-journal";
import { readFilePrefix } from "@noobot/shared/read-file-prefix";
import { fsLstat, fsOpen } from "../shared/storage/fs-adapter.js";
import { syncStorageDirectory } from "../shared/storage/durable-file.js";
import { resolveSessionArtifactMutationLock } from "./session-artifact-files.js";
import { sessionMutationCoordinator } from "./session-mutation-coordinator.js";
import { readJournalHead } from "./partition-storage/journal-io.js";

export function partitionMigrationRoot(sessionDir) {
  return path.join(sessionDir, PARTITION_MIGRATION_AUTHORITY.directory);
}

export function partitionMigrationAuthorityPath(sessionDir) {
  return path.join(sessionDir, PARTITION_MIGRATION_AUTHORITY.file);
}

export function readSessionStorageAuthority(sessionDir) {
  return readSessionStorageAuthorityFacts({
    stat: (file) => fsLstat(path.join(sessionDir, file)),
    readPrefix: (file, max) => readFilePrefix(path.join(sessionDir, file), max, fsOpen),
  });
}

function readPublishedPartition(sessionDir, migration) {
  return readPartitionAuthorityPublication(migration, (directory) =>
    readJournalHead(path.join(sessionDir, ...directory), { readBytes: 0 }),
  );
}

export async function readPartitionStorageRoot(sessionDir) {
  const facts = await readSessionStorageAuthority(sessionDir);
  if (!requirePartitionSessionAuthority(facts)) return null;
  if (facts.migration === undefined) return sessionDir;
  await readPublishedPartition(sessionDir, facts.migration);
  return partitionMigrationRoot(sessionDir);
}

export async function readPartitionMigrationReceipt(sessionDir, expectedSource, journalLimits) {
  const facts = await readSessionStorageAuthority(sessionDir);
  if (facts.migration === undefined && expectedSource !== null) {
    requireImmutableSessionAuthority(facts);
    return null;
  }
  if (!requirePartitionSessionAuthority(facts))
    throw Object.assign(new Error(`Partition authority is missing: ${sessionDir}`), {
      code: "SESSION_NOT_FOUND",
    });
  const { head, receipt } = await readPublishedPartition(sessionDir, facts.migration);
  assertPartitionSessionJournalPolicy(head, journalLimits);
  if (receipt !== null) {
    bindImmutableMigrationSource(receipt.source, expectedSource);
    try {
      await syncStorageDirectory(sessionDir);
    } catch (cause) {
      throw partitionMigrationPublicationUncertain(cause);
    }
  }
  return receipt;
}

export async function readImmutableAuthority(sessionDir) {
  const facts = await readSessionStorageAuthority(sessionDir);
  requireImmutableSessionAuthority(facts);
  return facts;
}

export function withSessionStorageAuthorityLock(sessionDir, operation) {
  return sessionMutationCoordinator.run(resolveSessionArtifactMutationLock(sessionDir), operation);
}

export function withImmutableAuthorityMutation(sessionDir, operation) {
  return withSessionStorageAuthorityLock(sessionDir, async () => {
    const authority = await readImmutableAuthority(sessionDir);
    return operation(authority);
  });
}
