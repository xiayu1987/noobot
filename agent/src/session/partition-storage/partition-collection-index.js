/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PARTITION_COLLECTION_PUBLICATION } from "@noobot/session-protocol/partition-journal";
import { requirePartitionTransaction } from "@noobot/session-protocol/partition-transaction";
import { planPartitionEntityDirectory } from "./partition-entity-directory.js";
import { observePartitionCommitPhase } from "./partition-commit-observation.js";
const attached = new WeakSet();

export function attachPartitionCollectionPublication(journal) {
  if (!attached.has(journal)) {
    journal.registerPublicationParticipant(PARTITION_COLLECTION_PUBLICATION, {
      validate: (request) => requirePartitionTransaction(request.payload, request.sequence),
      plan: async ({ previous, accepted, snapshot, record, state }) => {
        const directory = await observePartitionCommitPhase("planCollectionDirectory", () =>
          planPartitionEntityDirectory(journal, {
            previous,
            accepted,
            snapshot,
            record,
            state,
          }),
        );
        return directory;
      },
      prepare: async (publication) => {
        const directory = publication.state;
        if (directory) {
          await observePartitionCommitPhase("persistCollectionDirectory", () =>
            directory.persist(),
          );
          for (const [partition, { collectionRoot }] of directory.sealedCollections)
            publication.collectionRoots.set(partition, collectionRoot);
        }
      },
      published: ({ state }) => state?.cachePublishedPages(),
    });
    attached.add(journal);
  }
}
