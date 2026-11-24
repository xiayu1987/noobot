/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import {
  PARTITION_MIGRATION_AUTHORITY,
  readPartitionAuthorityPublication,
  readSessionStorageAuthorityFacts,
  requirePartitionSessionAuthority,
} from "@noobot/session-protocol/session-reader";
import { readFilePrefix } from "@noobot/shared/read-file-prefix";
import { fsLstat, fsOpen } from "../shared/storage/fs-adapter.js";
import { resolveSessionArtifactMutationLock } from "./session-artifact-files.js";
import { sessionMutationCoordinator } from "./session-mutation-coordinator.js";
import { readJournalHead } from "./partition-storage/journal-io.js";

export function partitionMigrationRoot(sessionDir) {
  return path.join(sessionDir, PARTITION_MIGRATION_AUTHORITY.directory);
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

export function withSessionStorageAuthorityLock(sessionDir, operation) {
  return sessionMutationCoordinator.run(resolveSessionArtifactMutationLock(sessionDir), operation);
}
