/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { partitionMessageEntryKey } from "@noobot/session-protocol/partition-session-messages";
import { PARTITION_LIFECYCLE_HEADER } from "@noobot/session-protocol/partition-transaction";
import { preparePartitionContextIndex } from "../../src/session/partition-storage/partition-context-index.js";
import { preparePartitionDisplayTransaction } from "../../src/session/partition-storage/partition-display-transaction.js";

export async function prepareFixtureContextTruncation(transactions, snapshot, count, mutations) {
  await transactions.withCollectionReader(snapshot, async (read) => {
    const previous = (await read({ collection: "metadata", keys: ["messageCount"] })).get(
      "messageCount",
    ).value;
    const records = [];
    for (let ordinal = count + 1; ordinal <= previous; ordinal += 1) {
      const key = partitionMessageEntryKey("messageOrder", snapshot.sessionId, ordinal);
      const uid = (await read({ collection: "messageOrder", keys: [key] })).get(key).value;
      records.push((await read({ collection: "messages", keys: [uid] })).get(uid).value);
    }
    const transitions = records.map((before) => ({ before, after: null }));
    const view = {
      generation: snapshot.sequence,
      pageRecords: snapshot.limits.pageRecords,
      getLatestMany: (query) => read({ ...query, includeOwner: true }),
    };
    await preparePartitionContextIndex(view, mutations, transitions);
    const displayMutations = await projectTruncation(view, mutations, records);
    const originalLength = displayMutations.length;
    await preparePartitionDisplayTransaction({
      snapshot,
      view,
      mutations: displayMutations,
      scope: { sessionId: snapshot.sessionId, parentSessionId: "" },
      transitions,
    });
    mutations.push(...displayMutations.slice(originalLength));
  });
}

async function projectTruncation(view, mutations, records) {
  const projection = [...mutations];
  const tails = new Map();
  for (const {
    message: { turnScopeId },
    turnOrdinal,
  } of records)
    if (!tails.has(turnScopeId)) tails.set(turnScopeId, turnOrdinal - 1);
  const turns = await view.getLatestMany({ collection: "turns", keys: [...tails.keys()] });
  const removed = new Set();
  for (const [key, messageCount] of tails) {
    if (messageCount === 0) removed.add(key);
    if (mutations.some((mutation) => mutation.collection === "turns" && mutation.key === key))
      continue;
    const { owner, mutation } = turns.get(key);
    projection.push({
      collection: "turns",
      key,
      owner,
      ...(messageCount ? { value: { ...mutation.value, messageCount } } : { remove: true }),
    });
  }
  const { collection, key } = PARTITION_LIFECYCLE_HEADER;
  const {
    owner,
    mutation: { value },
  } = (await view.getLatestMany({ collection, keys: [key] })).get(key);
  if (removed.has(value.activeTurnScopeId))
    projection.push({ collection, key, owner, value: { ...value, activeTurnScopeId: "" } });
  for (const [turnScopeId, entry] of await view.getLatestMany({
    collection: "lifecycle",
    keys: [...removed],
  }))
    if (entry !== null)
      projection.push({
        collection: "lifecycle",
        key: turnScopeId,
        owner: entry.owner,
        remove: true,
      });
  return projection;
}
