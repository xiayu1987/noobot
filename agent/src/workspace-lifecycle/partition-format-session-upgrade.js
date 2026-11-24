/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { projectStoredSessionMetadata } from "@noobot/session-protocol";
import { removeRetiredSessionProjections } from "@noobot/session-repair";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { readPartitionSessionMessageCount } from "@noobot/session-protocol/partition-session-messages";
import {
  PARTITION_TITLE_CANDIDATES_ROOT,
  updatePartitionTitleCandidates,
  verifyPartitionTitleCandidateWindow,
} from "@noobot/session-protocol/partition-title-index";
import {
  assertPartitionSessionScope,
  assertPartitionStoredSessionMetadata,
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
  const { transactions, journal, source, rebuildTitles } = context;
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
        if (!rebuildTitles)
          await verifyPartitionTitleCandidateWindow(
            {
              get: async (collection, key) =>
                (await read({ collection, keys: [key] })).get(key)?.value ?? null,
            },
            {
              after,
              through: after + limit,
              count,
              ordinals: candidates.map(({ ordinal }) => ordinal),
            },
          );
        return candidates;
      }),
    );
  try {
    return await readPage();
  } catch (error) {
    if (error.code !== "SESSION_QUERY_BUDGET" || limit <= 1) throw error;
    const half = Math.floor(limit / 2);
    const left = await readTitleCandidates(context, after, half);
    const right = await readTitleCandidates(context, after + half, limit - half);
    return [...left, ...right];
  }
}

async function appendSessionChanges(
  { journal, transactions, source, rebuildTitles },
  ordinals,
  initialize,
) {
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
          const migrated = projectStoredSessionMetadata(metadata);
          removeRetiredSessionProjections(migrated);
          assertPartitionStoredSessionMetadata(snapshot, migrated, source.scope);
          plan.set(collection, key, migrated);
        }
        if (initialize && rebuildTitles) {
          const root = PARTITION_TITLE_CANDIDATES_ROOT;
          if ((await plan.get(root.collection, root.key)) !== null)
            throw partitionJournalError(
              "SESSION_STORAGE_CORRUPT",
              "Legacy journal already has a title index",
            );
          plan.set(root.collection, root.key, { ordinals: [] });
        }
        if (rebuildTitles)
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
    throw partitionJournalError(
      "SESSION_STORAGE_UPGRADE_BLOCKED",
      "Session upgrade was not committed",
    );
}

async function writeTitleChanges(context, ordinals, initialize) {
  try {
    await appendSessionChanges(context, ordinals, initialize);
  } catch (error) {
    if (error.code !== "SESSION_TRANSACTION_BUDGET" || ordinals.length < 2) throw error;
    const middle = Math.floor(ordinals.length / 2);
    await writeTitleChanges(context, ordinals.slice(0, middle), initialize);
    await writeTitleChanges(context, ordinals.slice(middle), false);
  }
}

async function rebuildTitleCandidates(context, signal) {
  const { journal, source } = context;
  const limit = journal.head.limits.pageRecords;
  let initialize = true;
  let ordinals = [];
  for (let after = 0; after < source.count; after += limit) {
    signal?.throwIfAborted();
    const candidates = await readTitleCandidates(
      context,
      after,
      Math.min(limit, source.count - after),
    );
    ordinals.push(...candidates.map(({ ordinal }) => ordinal));
    if (ordinals.length < limit) continue;
    await writeTitleChanges(context, ordinals, initialize);
    initialize = false;
    ordinals = [];
  }
  if (initialize || ordinals.length) await writeTitleChanges(context, ordinals, initialize);
}

async function verifyTitleCandidates(context, signal) {
  const { journal, source } = context;
  const limit = journal.head.limits.pageRecords;
  let firstTitle = "";
  let after = 0;
  do {
    signal?.throwIfAborted();
    const length = Math.min(limit, source.count - after);
    const candidates = await readTitleCandidates(context, after, length);
    firstTitle ||= candidates[0]?.title ?? "";
    after += length;
  } while (after < source.count);
  return firstTitle;
}

export async function upgradePartitionFormatSession(journal, signal, rebuildTitles) {
  if (journal.head.sequence === 0) return;
  const transactions = new PartitionTransactions(journal);
  const source = await readSourceMetadata(transactions, journal);
  const context = { journal, transactions, source, rebuildTitles };
  signal?.throwIfAborted();
  if (rebuildTitles) await rebuildTitleCandidates(context, signal);
  else await appendSessionChanges(context, [], true);
  await verifyUpgradedPartitionSession(journal, signal);
}

export async function verifyUpgradedPartitionSession(journal, signal) {
  if (journal.head.sequence === 0) return;
  const transactions = new PartitionTransactions(journal);
  const source = await readSourceMetadata(transactions, journal);
  const sessions = new PartitionSessionTransactions(journal, source.scope);
  await journal.withPublicationSnapshot((snapshot) => sessions.readMetadata(snapshot));
  const expectedTitle = await verifyTitleCandidates(
    { journal, transactions, source, rebuildTitles: false },
    signal,
  );
  await journal.withPublicationSnapshot(async (snapshot) => {
    const title = await readPartitionSessionAutoTitle({ journal, snapshot, scope: source.scope });
    if (title !== expectedTitle)
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Migrated automatic title disagrees with visible messages",
      );
  });
}
