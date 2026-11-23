/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { exactObject, positive } from "./partition-journal-fields.js";
import { partitionJournalError } from "./errors.js";
import {
  PARTITION_ENTITY_DIRECTORY,
  partitionEntityPageBytes,
} from "./partition-entity-page-budget.js";
import {
  decodePartitionJournalControl,
  encodePartitionJournalControl,
} from "./partition-journal-control.js";

export const EMPTY_SEALED_COLLECTION = "empty";

export function encodePartitionJournalDirectory(entry) {
  const { epoch, partition, firstSequence, lastSequence, committedBytes, collectionRoot } = entry;
  let root = collectionRoot;
  if (root !== null && root !== EMPTY_SEALED_COLLECTION) {
    const { segment, offset, bytes } = root.position;
    root = [segment, offset, bytes, root.level];
  }
  return encodePartitionJournalControl([
    epoch,
    partition,
    firstSequence,
    lastSequence,
    committedBytes,
    root,
  ]);
}

export function decodePartitionJournalDirectory(serialized) {
  const tuple = decodePartitionJournalControl(serialized);
  if (!Array.isArray(tuple) || tuple.length !== 6)
    throw new TypeError("Invalid partition directory tuple");
  const [epoch, partition, firstSequence, lastSequence, committedBytes, root] = tuple;
  let collectionRoot = root;
  if (root !== null && root !== EMPTY_SEALED_COLLECTION) {
    if (!Array.isArray(root) || root.length !== 4)
      throw new TypeError("Invalid partition directory root tuple");
    const [segment, offset, bytes, level] = root;
    collectionRoot = { position: { segment, offset, bytes }, level };
  }
  return { epoch, partition, firstSequence, lastSequence, committedBytes, collectionRoot };
}

export function requireEntityDirectoryPosition(position) {
  exactObject(position, ["segment", "offset", "bytes"], "entity directory position");
  for (const field of ["segment", "offset"])
    if (!Number.isSafeInteger(position[field]) || position[field] < 0)
      throw new TypeError("Invalid entity directory position");
  positive(position.bytes, "directory page bytes");
  return position;
}

export function requireEntityDirectoryHead(directory, limits) {
  exactObject(
    directory,
    [
      "identities",
      "historicalOperations",
      "latestUpdates",
      "activeCollection",
      "segment",
      "offset",
      "bytes",
    ],
    "entity directory head",
  );
  for (const field of ["segment", "offset", "bytes"])
    if (!Number.isSafeInteger(directory[field]) || directory[field] < 0)
      throw new TypeError("Invalid entity directory boundary");
  if (directory.offset > limits.partitionBytes || directory.bytes < directory.offset)
    throw new TypeError("Invalid entity directory extent");
  const { identities, historicalOperations, latestUpdates, activeCollection } = directory;
  if (identities === null && (latestUpdates !== null || activeCollection !== null))
    throw new TypeError("Entity references require created identities");
  if (identities === null && historicalOperations === null) {
    if (directory.segment || directory.offset || directory.bytes)
      throw new TypeError("Empty directory has a nonempty extent");
    return directory;
  }
  if (directory.offset === 0) throw new TypeError("Published directory has an empty tail");
  for (const root of [identities, historicalOperations, latestUpdates, activeCollection])
    if (root !== null) requirePublishedEntityDirectoryRoot(root, directory, limits);
  return directory;
}

export function requirePublishedEntityDirectoryPosition(position, directory, limits) {
  requireEntityDirectoryPosition(position);
  const extent = position.offset + position.bytes;
  if (
    position.bytes > partitionEntityPageBytes(limits) ||
    extent > limits.partitionBytes ||
    position.segment > directory.segment ||
    (position.segment === directory.segment && extent > directory.offset)
  )
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Entity directory page exceeds publication boundary",
    );
  return position;
}

function requirePublishedEntityDirectoryRoot(root, directory, limits) {
  exactObject(root, ["position", "level"], "entity directory root");
  requirePublishedEntityDirectoryPosition(root.position, directory, limits);
  if (
    !Number.isSafeInteger(root.level) ||
    root.level < 0 ||
    root.level > PARTITION_ENTITY_DIRECTORY.maxLevel
  )
    throw new TypeError("Invalid entity directory root level");
  return root;
}

export function partitionJournalPathParts(partition) {
  if (!Number.isSafeInteger(partition) || partition < 0)
    throw new TypeError("Invalid partition number");
  const encoded = partition.toString(16).padStart(14, "0");
  return [encoded.slice(0, 4), encoded.slice(4, 8), encoded.slice(8)];
}

function invalidSealedDirectoryExtent(entry, head, partition, activeFirst) {
  return (
    !Number.isSafeInteger(entry.lastSequence) ||
    !Number.isSafeInteger(entry.committedBytes) ||
    entry.committedBytes <= 0 ||
    entry.committedBytes > head.limits.partitionBytes ||
    entry.lastSequence < entry.firstSequence ||
    entry.lastSequence >= activeFirst ||
    (partition === head.tail.partition - 1 && entry.lastSequence !== activeFirst - 1) ||
    entry.lastSequence - entry.firstSequence >= head.limits.partitionRecords
  );
}

export function requirePartitionJournalDirectory(entry, head, partition) {
  exactObject(
    entry,
    ["epoch", "partition", "firstSequence", "lastSequence", "committedBytes", "collectionRoot"],
    "partition directory",
  );
  positive(entry.firstSequence, "partition first sequence");
  const activeFirst = head.sequence - head.partitionRecords + 1;
  if (
    entry.epoch !== head.epoch ||
    entry.partition !== partition ||
    !Number.isSafeInteger(partition) ||
    partition < 0 ||
    partition > head.tail.partition ||
    entry.firstSequence > head.sequence ||
    (partition === 0 && entry.firstSequence !== 1) ||
    (partition === head.tail.partition
      ? entry.firstSequence !== activeFirst ||
        entry.lastSequence !== null ||
        entry.committedBytes !== null ||
        entry.collectionRoot !== null
      : invalidSealedDirectoryExtent(entry, head, partition, activeFirst))
  )
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid partition directory boundary");
  if (partition === head.tail.partition || head.publication !== "collections") {
    if (entry.collectionRoot !== null) throw new TypeError("Unexpected sealed collection root");
    return entry;
  }
  if (entry.collectionRoot === null)
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Sealed collection root is missing");
  if (entry.collectionRoot === EMPTY_SEALED_COLLECTION) return entry;
  if (head.entityDirectory.identities === null)
    throw new TypeError("Collection root requires a published entity directory");
  requirePublishedEntityDirectoryRoot(entry.collectionRoot, head.entityDirectory, head.limits);
  return entry;
}

export function requireLocalPartitionReference({ epoch, partition, sequence }, extent) {
  if (
    epoch !== extent.epoch ||
    partition !== extent.partition ||
    sequence < extent.firstSequence ||
    sequence > extent.lastSequence
  )
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Local entity reference exceeds partition",
    );
}
