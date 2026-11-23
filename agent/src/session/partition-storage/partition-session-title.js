/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isSessionAutoTitleCandidate, resolveSessionAutoTitle } from "@noobot/session-protocol";
import {
  readPartitionSessionMessageCount,
  requirePartitionVisibleMessageTurnOwnership,
} from "@noobot/session-protocol/partition-session-messages";
import { readPartitionMessagePreview } from "./partition-list-reader.js";
import {
  readFirstPartitionTitleCandidate,
  updatePartitionTitleCandidates,
} from "@noobot/session-protocol/partition-title-index";
import { readSessionOrderRecord } from "./partition-message-reader.js";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { createPartitionIndexMutations } from "./partition-index-mutations.js";
import { PartitionSessionTransactions } from "./partition-session-transactions.js";

export async function readPartitionTitleCandidate(read, record) {
  if (!isSessionAutoTitleCandidate(record.message)) return "";
  await requirePartitionVisibleMessageTurnOwnership(read, [record]);
  const { content } = await readPartitionMessagePreview(read, record);
  return resolveSessionAutoTitle({ ...record.message, content });
}

export async function readPartitionSessionAutoTitle({ journal, snapshot, scope }) {
  const transactions = new PartitionSessionTransactions(journal, scope);
  return transactions.read(snapshot, (read, scope, { generation }) =>
    readIndexedTitle({ read, snapshot, scope, generation }),
  );
}

async function readIndexedTitle({ read, snapshot, scope, generation }) {
  const ordinal = await readFirstPartitionTitleCandidate({
    get: async (collection, key) =>
      (await read({ collection, keys: [key] })).get(key)?.value ?? null,
  });
  if (ordinal === null) return "";
  const count = await readPartitionSessionMessageCount(read);
  if (ordinal > count)
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Title candidate is outside visible history",
    );
  const record = await readSessionOrderRecord({ read, snapshot, scope, generation }, ordinal);
  const title = await readPartitionTitleCandidate(read, record);
  if (!title) throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid title candidate");
  return title;
}

export async function preparePartitionSessionTitle({ view, mutations, transitions }) {
  if (transitions.length === 0) return;
  const plan = createPartitionIndexMutations(view, mutations);
  const membership = [];
  for (const { before, after } of transitions) {
    const previous =
      before === null ? "" : await readPartitionTitleCandidate(plan.readOriginal, before);
    const next = after === null ? "" : await readPartitionTitleCandidate(plan.readStaged, after);
    if (previous && !next) membership.push({ ordinal: before.sessionOrdinal, present: false });
    if (!previous && next) membership.push({ ordinal: after.sessionOrdinal, present: true });
  }
  membership.sort((a, b) => Number(a.present) - Number(b.present));
  await updatePartitionTitleCandidates(plan, membership);
  await plan.apply();
}
