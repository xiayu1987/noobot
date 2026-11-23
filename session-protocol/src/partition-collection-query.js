/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requirePartitionCollection } from "./partition-collections.js";
import { PARTITION_HISTORICAL_OPERATIONS } from "./partition-collection-names.js";
import {
  PARTITION_JOURNAL_FRAME,
  PartitionAdmissionRejection,
  requireCapturedPartitionJournalSnapshot,
} from "./partition-journal.js";
import { encodeBoundedJournalJson, measureBoundedJournalJson } from "./partition-journal-json.js";
import { partitionEntityKey, requirePartitionEntityOwner } from "./partition-transaction.js";

function queryBudgetExceeded(message) {
  return new PartitionAdmissionRejection("SESSION_QUERY_BUDGET", message);
}

export function requirePartitionCollectionPageLimit(snapshot, limit) {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new TypeError("Invalid partition page record limit");
  if (limit > snapshot.limits.pageRecords) throw queryBudgetExceeded("Page exceeds record budget");
}

export function createPartitionCollectionReadBudget(snapshot, consumeOperationBytes) {
  let remaining = snapshot.limits.pageBytes;
  const boundary = new Error("Partition collection window boundary");
  let window = null;
  return Object.freeze({
    consume(bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 0)
        throw new TypeError("Invalid partition collection read size");
      if (bytes > remaining) {
        if (window?.length > 0) throw boundary;
        throw queryBudgetExceeded(
          `Collection query exceeds read byte budget: ${bytes} requested, ${remaining} remaining`,
        );
      }
      consumeOperationBytes?.(bytes);
      remaining -= bytes;
    },
    async readWindow(length, readRecord) {
      if (length === 0) return [];
      requirePartitionCollectionPageLimit(snapshot, length);
      if (window !== null) throw new TypeError("Partition collection windows cannot overlap");
      const records = [];
      window = records;
      try {
        while (records.length < length) records.push(await readRecord(records.length));
      } catch (error) {
        if (error !== boundary) throw error;
      } finally {
        window = null;
      }
      return records;
    },
  });
}

export function partitionCollectionResultBytes(entry, remainingBytes) {
  return measureBoundedJournalJson(
    entry,
    remainingBytes,
    PARTITION_JOURNAL_FRAME.maxJsonDepth,
    () => queryBudgetExceeded("Entity results exceed byte budget"),
  );
}

export function createPartitionCollectionSlotBudget(snapshot) {
  let remaining = snapshot.limits.pageBytes;
  return (encodedBytes) => {
    if (!Number.isSafeInteger(encodedBytes) || encodedBytes < 1)
      throw new TypeError("Invalid encoded collection slot size");
    if (encodedBytes > remaining)
      throw queryBudgetExceeded("Entity slots exceed result byte budget");
    remaining -= encodedBytes;
  };
}

function requireQueryFields(query, fields, label) {
  if (
    !query ||
    Object.getPrototypeOf(query) !== Object.prototype ||
    Reflect.ownKeys(query).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(query, field))
  )
    throw new TypeError(`Invalid ${label} fields`);
  for (const field of fields)
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(query, field), "value"))
      throw new TypeError(`${label} requires data properties`);
}

export function requirePartitionLocalCollection(collection) {
  requirePartitionCollection(collection);
  if (collection === PARTITION_HISTORICAL_OPERATIONS)
    throw new TypeError("Historical operations require session-wide point lookup");
  return collection;
}

export function requireSessionCollectionQuery(query) {
  requireQueryFields(query, ["snapshot", "collection", "keys"], "Session collection query");
  const { snapshot, collection, keys } = query;
  return { snapshot, collection, keys: captureQueryItems(snapshot, collection, keys) };
}

export function requireSessionCollectionOwnerQuery(query) {
  requireQueryFields(query, ["snapshot", "collection", "entities"], "Session owner query");
  const { snapshot, collection, entities } = query;
  requirePartitionLocalCollection(collection);
  const captured = captureQueryItems(snapshot, collection, entities, (entity) => {
    requireQueryFields(entity, ["key", "owner"], "Session owner selector");
    requirePartitionEntityOwner(entity.owner, Number.MAX_SAFE_INTEGER);
    return entity.key;
  });
  const owners = new Map(captured.map(({ key, owner }) => [key, owner]));
  return { snapshot, collection, keys: [...owners.keys()], owners };
}

export function requirePartitionCollectionQuery(query) {
  requireQueryFields(
    query,
    ["snapshot", "partition", "collection", "keys"],
    "Partition collection query",
  );
  const { snapshot, partition, collection, keys } = query;
  requirePartitionLocalCollection(collection);
  const detached = captureQueryItems(snapshot, collection, keys);
  if (!Number.isSafeInteger(partition) || partition < 0 || partition > snapshot.tail.partition)
    throw new RangeError("Partition is outside snapshot");
  return { snapshot, partition, collection, keys: detached };
}

function captureQueryItems(snapshot, collection, items, keyOf = (key) => key) {
  requireCapturedPartitionJournalSnapshot(snapshot);
  requirePartitionCollection(collection);
  if (!Array.isArray(items) || items.length > snapshot.limits.pageRecords)
    throw queryBudgetExceeded("Query exceeds key count budget");

  const budgetError = () => queryBudgetExceeded("Query exceeds byte budget");
  const detached = JSON.parse(
    encodeBoundedJournalJson(items, {
      budget: snapshot.limits.pageBytes,
      maxDepth: PARTITION_JOURNAL_FRAME.maxJsonDepth,
      budgetError,
    }),
  );
  const keys = detached.map(keyOf);
  for (const key of keys) partitionEntityKey(collection, key);
  if (new Set(keys).size !== keys.length)
    throw new TypeError("Partition lookup requires unique entity keys");
  return detached;
}
