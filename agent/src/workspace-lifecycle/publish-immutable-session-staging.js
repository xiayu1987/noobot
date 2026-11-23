/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  encodePartitionMigrationAuthority,
  partitionMigrationPublicationUncertain,
  requirePartitionMigrationBudget,
} from "@noobot/session-protocol/session-reader";
import { captureImmutableMigrationSourceIdentity } from "@noobot/session-protocol/immutable-storage";
import { PartitionJournal } from "../session/partition-storage/partition-journal.js";
import { replaceJournalFile } from "../session/partition-storage/journal-file-publication.js";
import {
  partitionMigrationAuthorityPath,
  partitionMigrationRoot,
  readPartitionMigrationReceipt,
  withSessionStorageAuthorityLock,
} from "../session/session-storage-authority.js";
import { syncStorageDirectory, withStorageCleanup } from "../shared/storage/durable-file.js";
import { fsRealpath } from "../shared/storage/fs-adapter.js";
import { withExclusiveImmutableMigrationSource } from "./immutable-session-migration-source.js";
import { verifyImmutableSessionStaging } from "./verify-immutable-session-staging.js";

async function publishStaging({ sourceRoot, identity, journalLimits, limit, maxBytes, signal }) {
  const root = partitionMigrationRoot(sourceRoot);
  if ((await fsRealpath(root)) !== root)
    throw new TypeError("Partition migration directory must not redirect to another path");

  return withExclusiveImmutableMigrationSource(
    { sessionDir: sourceRoot, expectedSource: identity, signal },
    async (source) => {
      const journal = await PartitionJournal.open({
        root,
        sessionId: source.scope.sessionId,
        expectedSessionLimits: journalLimits,
      });
      return withStorageCleanup(
        async () => {
          const { source: publishedSource, target } = await verifyImmutableSessionStaging(
            { source, journal, scope: source.scope, limit, maxBytes, signal },
            async (report) => {
              await syncStorageDirectory(sourceRoot);
              return replaceJournalFile(
                partitionMigrationAuthorityPath(sourceRoot),
                encodePartitionMigrationAuthority(report),
                () => signal?.throwIfAborted(),
                partitionMigrationPublicationUncertain,
              );
            },
          );
          return { source: publishedSource, target };
        },
        () => journal.close(),
      );
    },
  );
}

export async function publishImmutableSessionStaging({
  sessionDir,
  expectedSource,
  targetStorageBudget,
  limit,
  maxBytes,
  signal,
}) {
  signal?.throwIfAborted();
  const identity = captureImmutableMigrationSourceIdentity(expectedSource);
  const { journalLimits } = requirePartitionMigrationBudget({
    targetStorageBudget,
    limit,
    maxBytes,
  });
  const sourceRoot = await fsRealpath(sessionDir);
  return withSessionStorageAuthorityLock(sourceRoot, async () => {
    signal?.throwIfAborted();
    const receipt = await readPartitionMigrationReceipt(sourceRoot, identity, journalLimits);
    if (receipt === null)
      return publishStaging({ sourceRoot, identity, journalLimits, limit, maxBytes, signal });
    return receipt;
  });
}
