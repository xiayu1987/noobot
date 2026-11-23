/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepStrictEqual } from "node:util";
import { assertSessionScopeIdentity, resolveSessionAutoTitle } from "@noobot/session-protocol";
import {
  PARTITION_TITLE_CANDIDATES_ROOT,
  readPartitionTitleCandidates,
  verifyPartitionTitleCandidatePage,
} from "@noobot/session-protocol/partition-title-index";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import { readMigrationMessageRecords } from "./immutable-session-migration-messages.js";
import { requirePageBounds } from "@noobot/session-protocol/message-read-budget";
import {
  applySessionDisplaySourceDelta,
  emptySessionDisplaySourceCounts,
  sessionDisplayMessageContribution,
} from "@noobot/session-protocol/session-reader";
import { PartitionMessageRange } from "../session/partition-storage/partition-message-range.js";
import { PartitionSessionMessages } from "../session/partition-storage/partition-session-messages.js";
import { PartitionSessionTransactions } from "../session/partition-storage/partition-session-transactions.js";
import { PartitionTransactions } from "../session/partition-storage/partition-transactions.js";

export async function verifyImmutableSessionMessages({
  source,
  journal,
  snapshot,
  scope,
  limit,
  maxBytes,
  signal,
}) {
  requirePageBounds({ after: 0, limit, maxBytes });
  assertSessionScopeIdentity({ ...scope, session: source.scope });
  signal?.throwIfAborted();
  const ranges = new PartitionMessageRange(journal, scope);
  const target = {
    generation: snapshot.sequence,
    readMessagePage: (selection) => ranges.readPage(snapshot, selection),
  };
  await using targetRecords = readMigrationMessageRecords(target, { limit, maxBytes }, signal);
  const transactions = new PartitionSessionTransactions(journal, scope);
  const titleIndex = {
    get: (collection, key) =>
      transactions.read(snapshot, async (read) => {
        signal?.throwIfAborted();
        return (await read({ collection, keys: [key] })).get(key)?.value ?? null;
      }),
  };
  await using candidates = readPartitionTitleCandidates(titleIndex);
  let messageCount = 0;
  let displaySourceCounts = emptySessionDisplaySourceCounts();
  for await (const expected of readMigrationMessageRecords(source, { limit, maxBytes }, signal)) {
    const actual = await targetRecords.next();
    if (actual.done || !isDeepStrictEqual(actual.value, expected))
      throw immutableStorageError(
        `Staged message differs from source at position ${expected.ordinal}`,
      );
    messageCount += 1;
    if (resolveSessionAutoTitle(expected.message)) {
      const candidate = await candidates.next();
      if (candidate.done || candidate.value !== expected.ordinal)
        throw immutableStorageError(
          `Staged title candidates differ from source at position ${expected.ordinal}`,
        );
    }
    displaySourceCounts = applySessionDisplaySourceDelta(
      displaySourceCounts,
      sessionDisplayMessageContribution(expected.message),
    );
  }
  if (!(await targetRecords.next()).done)
    throw immutableStorageError(
      `Staged session has an extra message at position ${messageCount + 1}`,
    );
  if (!(await candidates.next()).done)
    throw immutableStorageError("Staged title candidates contain an extra ordinal");
  await new PartitionTransactions(journal).visitCollectionKeys(
    snapshot,
    [PARTITION_TITLE_CANDIDATES_ROOT.collection],
    (key) => verifyPartitionTitleCandidatePage(titleIndex, key),
  );
  const messages = new PartitionSessionMessages(journal, scope);
  if (
    !isDeepStrictEqual(await messages.readDisplaySourceCounts({ snapshot }), {
      messageCount,
      ...displaySourceCounts,
    })
  )
    throw immutableStorageError("Staged display source counts differ from the migration source");
  return messageCount;
}
