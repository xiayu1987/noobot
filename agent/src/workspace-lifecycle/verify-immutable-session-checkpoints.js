/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepStrictEqual } from "node:util";
import { isCanonicalText } from "@noobot/shared/value";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import { partitionCheckpointOrderKey } from "@noobot/session-protocol/partition-summary-checkpoints";
import { PartitionSessionMessages } from "../session/partition-storage/partition-session-messages.js";
import { PartitionTransactions } from "../session/partition-storage/partition-transactions.js";
import { immutableCheckpointKey } from "../session/session-artifact-session/immutable-checkpoint-index.js";
import { immutableOrderKey } from "../session/session-artifact-session/immutable-order-key.js";

function keyParts(key) {
  let parts;
  try {
    parts = JSON.parse(key);
  } catch (cause) {
    throw immutableStorageError(`Invalid checkpoint index key: ${key}`, cause);
  }
  if (!Array.isArray(parts) || parts.length !== 2 || !isCanonicalText(parts[0]))
    throw immutableStorageError(`Invalid checkpoint index key: ${key}`);
  return parts;
}

async function* receipts(readPage, selection, signal) {
  let cursor = null;
  do {
    signal?.throwIfAborted();
    const page = await readPage({ ...selection, cursor });
    if (page === null)
      throw immutableStorageError(`Missing checkpoint head: ${selection.turnScopeId}`);
    yield* page.receipts;
    cursor = page.nextCursor;
  } while (cursor !== null);
}

async function verifyMatchedReceipts(source, target, turnScopeId) {
  for await (const expected of source) {
    const actual = await target.next();
    if (actual.done || !isDeepStrictEqual(actual.value, expected))
      throw immutableStorageError(`Staged checkpoint history differs from source: ${turnScopeId}`);
  }
  if (!(await target.next()).done)
    throw immutableStorageError(`Staged checkpoint history has extra receipts: ${turnScopeId}`);
}

async function verifyOrder(sourcePage, targetPage, selection, signal) {
  const target = receipts(targetPage, selection, signal);
  try {
    await verifyMatchedReceipts(
      receipts(sourcePage, selection, signal),
      target,
      selection.turnScopeId,
    );
  } finally {
    await target.return();
  }
}

async function verifySourceIndexes(source, signal) {
  await source.visitCollection("checkpoints", async (key, value) => {
    signal?.throwIfAborted();
    const [turnScopeId, id] = keyParts(key);
    if (
      !isCanonicalText(id) ||
      key !== immutableCheckpointKey(turnScopeId, id) ||
      !isDeepStrictEqual(await source.readCheckpoint(turnScopeId, id), value)
    )
      throw immutableStorageError(`Orphan source checkpoint receipt: ${key}`);
  });
  await source.visitCollection("checkpointOrder", async (key, id) => {
    signal?.throwIfAborted();
    const [turnScopeId] = keyParts(key);
    const receipt = isCanonicalText(id) ? await source.readCheckpoint(turnScopeId, id) : null;
    if (
      receipt === null ||
      key !== immutableCheckpointKey(turnScopeId, immutableOrderKey(receipt.checkpointRevision))
    )
      throw immutableStorageError(`Orphan source checkpoint order: ${key}`);
  });
}

async function verifyTargetKey({ collection, key, value, source, readTarget }) {
  if (collection === "checkpointHeads" || collection === "turnCheckpoints") {
    if ((await source.readCheckpointHead(key)) === null)
      throw immutableStorageError(`Staged session has an extra ${collection} record: ${key}`);
    return;
  }
  const [turnScopeId, part] = keyParts(key);
  const id = collection === "checkpoints" ? part : value?.checkpointId;
  if (!isCanonicalText(id)) throw immutableStorageError(`Invalid staged checkpoint index: ${key}`);
  const receipt = await readTarget(turnScopeId, id);
  const expected = await source.readCheckpoint(turnScopeId, id);
  if (receipt === null || expected === null || !isDeepStrictEqual(receipt, expected))
    throw immutableStorageError(`Orphan or extra staged checkpoint record: ${key}`);
  const canonicalKey =
    collection === "checkpoints"
      ? immutableCheckpointKey(turnScopeId, id)
      : partitionCheckpointOrderKey(turnScopeId, receipt.checkpointRevision);
  if (key !== canonicalKey) throw immutableStorageError(`Orphan staged checkpoint index: ${key}`);
}

export async function verifyImmutableSessionCheckpoints({
  source,
  journal,
  scope,
  snapshot,
  limit,
  maxBytes,
  signal,
}) {
  const transactions = new PartitionTransactions(journal);
  const messages = new PartitionSessionMessages(journal, scope);
  const readValue = (collection, key) =>
    transactions.withCollectionReader(snapshot, async (read) => {
      const entry = (await read({ collection, keys: [key] })).get(key);
      return entry === null ? null : entry.value;
    });
  await verifySourceIndexes(source, signal);
  await source.visitCollection("checkpointHeads", async (turnScopeId, expected) => {
    signal?.throwIfAborted();
    if (!isDeepStrictEqual(await readValue("checkpointHeads", turnScopeId), expected))
      throw immutableStorageError(`Staged checkpoint head differs from source: ${turnScopeId}`);
    await verifyOrder(
      source.readCheckpointPage,
      (options) => messages.readCheckpointPage({ snapshot, ...options }),
      { turnScopeId, limit, maxBytes },
      signal,
    );
  });
  await transactions.visitCollectionKeys(
    snapshot,
    ["checkpointHeads", "turnCheckpoints", "checkpoints", "checkpointOrder"],
    async (key, collection) => {
      signal?.throwIfAborted();
      const value = await readValue(collection, key);
      if (value === null) return;
      await verifyTargetKey({
        collection,
        key,
        value,
        source,
        readTarget: (turnScopeId, checkpointId) =>
          messages.readCheckpoint({ snapshot, turnScopeId, checkpointId }),
      });
    },
  );
}
