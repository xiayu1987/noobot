/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepStrictEqual } from "node:util";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import { PartitionSessionMessages } from "../session/partition-storage/partition-session-messages.js";
import { PartitionSessionStateReader } from "../session/partition-storage/partition-session-state-reader.js";
import { PartitionTransactions } from "../session/partition-storage/partition-transactions.js";

export async function verifyImmutableSessionLifecycle({
  source,
  journal,
  scope,
  snapshot,
  signal,
}) {
  const state = new PartitionSessionStateReader(journal, scope);
  const messages = new PartitionSessionMessages(journal, scope);
  const collections = new PartitionTransactions(journal);
  const readers = new Map([
    [
      "lifecycle",
      {
        source: (key) => source.readTurnState(key),
        target: (key) => state.readTurnState(snapshot, key),
      },
    ],
    [
      "replacements",
      {
        source: (key) => source.readTurnReplacement(key),
        target: (key) => state.readTurnReplacement(snapshot, key),
      },
    ],
    [
      "timings",
      {
        source: (key) => source.readTurnTiming(key),
        target: (turnScopeId) => messages.readTurnTiming({ snapshot, turnScopeId }),
      },
    ],
  ]);
  for (const [collection, read] of readers) {
    signal?.throwIfAborted();
    await source.visitCollection(collection, async (key, expected) => {
      signal?.throwIfAborted();
      if (!isDeepStrictEqual(await read.target(key), expected))
        throw immutableStorageError(`Staged ${collection} record differs from source: ${key}`);
    });
  }
  await collections.visitCollectionKeys(snapshot, readers.keys(), async (key, collection) => {
    signal?.throwIfAborted();
    const read = readers.get(collection);
    if ((await read.source(key)) === null && (await read.target(key)) !== null)
      throw immutableStorageError(`Staged session has an extra ${collection} record: ${key}`);
  });
}
