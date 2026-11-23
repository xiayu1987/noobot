/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import {
  bindImmutableMigrationSource,
  captureImmutableMigrationSourceIdentity,
} from "@noobot/session-protocol/immutable-storage";
import {
  assertPartitionMigrationBusinessCheckpointTarget,
  requirePartitionMigrationBudget,
} from "@noobot/session-protocol/session-reader";
import { PartitionJournal } from "../session/partition-storage/partition-journal.js";
import { withStorageCleanup } from "../shared/storage/durable-file.js";
import { fsRealpath } from "../shared/storage/fs-adapter.js";
import { withExclusiveImmutableMigrationSource } from "./immutable-session-migration-source.js";
import { importImmutableSessionBusinessState } from "./import-immutable-session-business-state.js";
import { importImmutableOperationReceipts } from "./import-immutable-operation-receipts.js";
import {
  verifyImmutableSessionBusinessState,
  verifyImmutableSessionStaging,
  withCurrentStagingHeads,
} from "./verify-immutable-session-staging.js";

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

export async function reconcileImmutableSessionStaging(
  { sessionDir, stagingDir, expectedSource, targetStorageBudget, limit, maxBytes, signal },
  checkpointStore,
) {
  signal?.throwIfAborted();
  const identity = captureImmutableMigrationSourceIdentity(expectedSource);
  const { journalLimits } = requirePartitionMigrationBudget({
    targetStorageBudget,
    limit,
    maxBytes,
  });
  const [sourceRoot, targetRoot] = await Promise.all([
    fsRealpath(sessionDir),
    fsRealpath(stagingDir),
  ]);
  if (contains(sourceRoot, targetRoot) || contains(targetRoot, sourceRoot))
    throw new TypeError("Migration source and staging directories must be disjoint");
  return withExclusiveImmutableMigrationSource(
    { sessionDir: sourceRoot, expectedSource: identity, signal },
    async (source) => {
      const checkpoint = checkpointStore?.checkpoint;
      if (checkpoint) bindImmutableMigrationSource(source.identity, checkpoint.source);
      const journal = await PartitionJournal.open({
        root: targetRoot,
        sessionId: source.scope.sessionId,
        expectedSessionLimits: journalLimits,
      });
      return withStorageCleanup(
        async () => {
          const context = { source, journal, scope: source.scope, limit, maxBytes, signal };
          if (checkpoint)
            assertPartitionMigrationBusinessCheckpointTarget(checkpoint, journal.head);
          else if (journal.head.sequence === 0) await importImmutableSessionBusinessState(context);
          await journal.usingSnapshot(async (snapshot) => {
            const pinned = { ...context, snapshot };
            await verifyImmutableSessionBusinessState(pinned);
            await withCurrentStagingHeads(pinned, () => {
              if (checkpointStore && !checkpoint)
                return checkpointStore.seal({
                  source: source.identity,
                  target: {
                    sessionId: snapshot.sessionId,
                    epoch: snapshot.epoch,
                    generation: snapshot.sequence,
                  },
                });
            });
          });
          await importImmutableOperationReceipts(context);
          return verifyImmutableSessionStaging(context);
        },
        () => journal.close(),
      );
    },
  );
}
