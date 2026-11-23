/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepStrictEqual } from "node:util";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import {
  PARTITION_TOOL_PAIRS,
  partitionToolPairKey,
} from "@noobot/session-protocol/partition-tool-pairs";
import { PartitionTransactions } from "../session/partition-storage/partition-transactions.js";
import { readPartitionToolPairAt } from "../session/partition-storage/partition-tool-pairs.js";

export async function verifyImmutableSessionToolPairs({
  source,
  journal,
  scope,
  snapshot,
  signal,
}) {
  const target = (key, identity) =>
    readPartitionToolPairAt({ journal, scope, snapshot, key, identity });
  await source.visitCollection(PARTITION_TOOL_PAIRS.pairs, (identity) =>
    source.withToolPair(identity, async (expected) => {
      signal?.throwIfAborted();
      const actual = await target(partitionToolPairKey(identity), identity);
      if (expected === null || !isDeepStrictEqual(actual?.header, expected.header))
        throw immutableStorageError(`Staged tool pair differs from source: ${identity}`);
      await expected.verifyResultCount(signal);
      let count = 0;
      await actual.visitResults(async (uid) => {
        if (!(await expected.hasResult(uid)))
          throw immutableStorageError(`Staged tool pair result differs from source: ${uid}`);
        count += 1;
      }, signal);
      if (count !== expected.header.resultCount)
        throw immutableStorageError(
          `Staged tool pair result count differs from source: ${identity}`,
        );
    }),
  );
  const collections = new PartitionTransactions(journal);
  await collections.visitCollectionKeys(snapshot, [PARTITION_TOOL_PAIRS.pairs], async (key) => {
    signal?.throwIfAborted();
    const actual = await target(key);
    if (actual === null) return;
    const { identity, ownerUid, resultCount } = actual.header;
    await source.withToolPair(identity, async (expected) => {
      if (expected !== null) return;
      if (ownerUid || resultCount)
        throw immutableStorageError(`Staged session has an extra tool pair: ${identity}`);
      await actual.visitResults(() => {
        throw immutableStorageError(`Staged session has an extra tool result: ${identity}`);
      }, signal);
    });
  });
}
