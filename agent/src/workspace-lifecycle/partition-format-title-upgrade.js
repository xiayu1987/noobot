/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { projectStoredSessionMetadata } from "@noobot/session-protocol";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { readPartitionSessionMessageCount } from "@noobot/session-protocol/partition-session-messages";
import {
  PARTITION_TITLE_CANDIDATES_ROOT,
  updatePartitionTitleCandidates,
} from "@noobot/session-protocol/partition-title-index";
import {
  assertPartitionSessionScope,
  PARTITION_SESSION_METADATA,
} from "@noobot/session-protocol/partition-transaction";
import { createPartitionIndexMutations } from "../session/partition-storage/partition-index-mutations.js";
import { readSessionOrderRecords } from "../session/partition-storage/partition-message-reader.js";
import {
  readPartitionSessionAutoTitle,
  readPartitionTitleCandidate,
} from "../session/partition-storage/partition-session-title.js";
import { PartitionSessionTransactions } from "../session/partition-storage/partition-session-transactions.js";
import { PartitionTransactions } from "../session/partition-storage/partition-transactions.js";

async function readSourceMetadata(transactions, journal) {
  return journal.withPublicationSnapshot((snapshot) =>
    transactions.withCollectionReader(snapshot, async (read) => {
      const { collection, key } = PARTITION_SESSION_METADATA;
      const metadata = (await read({ collection, keys: [key] })).get(key)?.value;
      const scope = { sessionId: snapshot.sessionId, parentSessionId: metadata?.parentSessionId };
      assertPartitionSessionScope(snapshot, metadata, scope);
      return { scope, metadata, count: await readPartitionSessionMessageCount(read) };
    }),
  );
}

async function readTitleCandidates(context, after, limit) {
  const { transactions, journal, source } = context;
  const { scope, count } = source;
  const readPage = () =>
    journal.withPublicationSnapshot((snapshot) =>
      transactions.withCollectionReader(snapshot, async (read) => {
        const records = await readSessionOrderRecords({
          read,
          snapshot,
          scope,
          count,
          page: { after },
          limit,
        });
        const candidates = [];
        for (const record of records) {
          const title = await readPartitionTitleCandidate(read, record);
          if (title) candidates.push({ ordinal: record.sessionOrdinal, title });
        }
        return candidates;
      }),
    );
  try {
    return await readPage();
  } catch (error) {
    if (error.code !== "SESSION_QUERY_BUDGET" || limit === 1) throw error;
    const half = Math.floor(limit / 2);
    const left = await readTitleCandidates(context, after, half);
    const right = await readTitleCandidates(context, after + half, limit - half);
    return [...left, ...right];
  }
}

async function appendTitleChanges({ journal, transactions, source }, ordinals, initialize) {
  const { epoch, sequence } = journal.head;
  const outcome = await transactions.commit(
    { epoch, expectedGeneration: sequence, operationId: randomUUID(), input: {} },
    {
      validateScope: (snapshot) =>
        assertPartitionSessionScope(snapshot, source.metadata, source.scope),
      prepare: async (snapshot, view) => {
        const mutations = [];
        const plan = createPartitionIndexMutations(view, mutations);
        if (initialize) {
          const { collection, key } = PARTITION_SESSION_METADATA;
          const metadata = await plan.get(collection, key);
          assertPartitionSessionScope(snapshot, metadata, source.scope);
          plan.set(collection, key, projectStoredSessionMetadata(metadata));
          const root = PARTITION_TITLE_CANDIDATES_ROOT;
          if ((await plan.get(root.collection, root.key)) !== null)
            throw partitionJournalError(
              "SESSION_STORAGE_CORRUPT",
              "Legacy journal already has a title index",
            );
          plan.set(root.collection, root.key, { ordinals: [] });
        }
        await updatePartitionTitleCandidates(
          plan,
          ordinals.map((ordinal) => ({ ordinal, present: true })),
        );
        await plan.apply();
        return { action: "commit", mutations, result: {} };
      },
    },
  );
  if (outcome.status !== "committed")
    throw partitionJournalError("SESSION_STORAGE_UPGRADE_BLOCKED", "Title index was not committed");
}

async function writeTitleChanges(context, ordinals, initialize) {
  try {
    await appendTitleChanges(context, ordinals, initialize);
  } catch (error) {
    if (error.code !== "SESSION_TRANSACTION_BUDGET" || ordinals.length < 2) throw error;
    const middle = Math.floor(ordinals.length / 2);
    await writeTitleChanges(context, ordinals.slice(0, middle), initialize);
    await writeTitleChanges(context, ordinals.slice(middle), false);
  }
}

export async function upgradePartitionFormatTitles(journal, signal) {
  if (journal.head.sequence === 0) return;
  const transactions = new PartitionTransactions(journal);
  const source = await readSourceMetadata(transactions, journal);
  const context = { journal, transactions, source };
  const limit = journal.head.limits.pageRecords;
  let firstTitle = "";
  let initialize = true;
  let ordinals = [];
  for (let after = 0; after < source.count; after += limit) {
    signal?.throwIfAborted();
    const candidates = await readTitleCandidates(
      context,
      after,
      Math.min(limit, source.count - after),
    );
    firstTitle ||= candidates[0]?.title ?? "";
    ordinals.push(...candidates.map(({ ordinal }) => ordinal));
    if (ordinals.length < limit) continue;
    await writeTitleChanges(context, ordinals, initialize);
    initialize = false;
    ordinals = [];
  }
  if (initialize || ordinals.length) await writeTitleChanges(context, ordinals, initialize);

  const sessions = new PartitionSessionTransactions(journal, source.scope);
  await journal.withPublicationSnapshot(async (snapshot) => {
    await sessions.readMetadata(snapshot);
    const title = await readPartitionSessionAutoTitle({ journal, snapshot, scope: source.scope });
    if (title !== firstTitle)
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Migrated automatic title disagrees with visible messages",
      );
  });
}
