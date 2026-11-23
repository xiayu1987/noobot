/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepStrictEqual } from "node:util";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import { PartitionSessionStateReader } from "../session/partition-storage/partition-session-state-reader.js";
import { PartitionTransactions } from "../session/partition-storage/partition-transactions.js";

async function verifyMembership({
  source,
  state,
  snapshot,
  dialogProcessId,
  limit,
  maxBytes,
  signal,
}) {
  let after = 0;
  while (true) {
    signal?.throwIfAborted();
    const selection = { dialogProcessId, after, limit, maxBytes };
    const expected = await source.readDialogTurnPage(selection);
    const actual = await state.readDialogTurnPage(snapshot, selection);
    if (
      !expected ||
      !actual ||
      expected.generation !== source.generation ||
      actual.generation !== snapshot.sequence ||
      expected.cursor !== actual.cursor ||
      expected.hasMore !== actual.hasMore ||
      !isDeepStrictEqual(expected.turnScopeIds, actual.turnScopeIds)
    )
      throw immutableStorageError(`Staged dialog turn membership differs: ${dialogProcessId}`);
    if (!actual.hasMore) return;
    after = actual.cursor;
  }
}

export async function verifyImmutableSessionDialogs({
  source,
  journal,
  snapshot,
  scope,
  limit,
  maxBytes,
  signal,
}) {
  const state = new PartitionSessionStateReader(journal, scope);
  const collections = new PartitionTransactions(journal);
  let count = 0;
  await source.visitCollection("dialogs", async (dialogProcessId, expected) => {
    signal?.throwIfAborted();
    const actual = await state.readDialog(snapshot, dialogProcessId);
    if (actual === null)
      throw immutableStorageError(`Staged dialog is missing: ${dialogProcessId}`);
    if (!isDeepStrictEqual(actual, expected)) {
      const fields = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].filter(
        (key) =>
          Object.hasOwn(expected, key) !== Object.hasOwn(actual, key) ||
          !isDeepStrictEqual(expected[key], actual[key]),
      );
      throw immutableStorageError(
        `Staged dialog differs from source: ${dialogProcessId} (${fields.join(", ")})`,
      );
    }
    await verifyMembership({
      source,
      state,
      snapshot,
      dialogProcessId,
      limit: Math.min(limit, snapshot.limits.pageRecords),
      maxBytes,
      signal,
    });
    count += 1;
  });
  await collections.visitCollectionKeys(snapshot, ["dialogs"], async (dialogProcessId) => {
    signal?.throwIfAborted();
    if (
      (await source.readDialog(dialogProcessId)) === null &&
      (await state.readDialog(snapshot, dialogProcessId)) !== null
    )
      throw immutableStorageError(`Staged session has an extra dialog: ${dialogProcessId}`);
  });
  return count;
}
