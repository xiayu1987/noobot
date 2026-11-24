/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { partitionEpochHexLength } from "./partition-epoch.js";

export const PARTITION_ENTITY_DIRECTORY_FORMAT = "noobot.partition-entity-directory/10";
export const PARTITION_ENTITY_DIRECTORY = Object.freeze({
  maxEntries: QUANTITY_THRESHOLDS.partitionStorage.entityDirectoryMaxEntries,
  maxLevel: 52,
});
export const PARTITION_ENTITY_PAGE_CODEC = Object.freeze({
  literal: 0,
  deflateRaw: 1,
  delta: 3,
});

const encoder = new TextEncoder();
const max = Number.MAX_SAFE_INTEGER;
const epoch = "0".repeat(partitionEpochHexLength);
const updatedLeaf = [max, max, max, max, max, max];
const child = [max, max, max, max];
const maxKeyBytes = LENGTH_THRESHOLDS.partitionStorage.entityPageKeyBytes;

const escapedBytes = (value) => encoder.encode(JSON.stringify(JSON.stringify(value))).length - 2;
const embeddedStringDelimiterBytes = escapedBytes("");
const fixedBytes =
  escapedBytes([epoch, PARTITION_ENTITY_DIRECTORY.maxLevel, []]) +
  encoder.encode(JSON.stringify({ payload: "", digest: "0".repeat(64) })).length +
  1;
const entryBytes = maxKeyBytes + Math.max(escapedBytes(updatedLeaf), escapedBytes(child)) + 6;

export function requirePartitionEntityPageKey(key) {
  if (partitionEntityPageKeyBytes(key) > maxKeyBytes)
    throw new RangeError("Entity identity exceeds page budget");
}

function isTrailingSurrogate(code) {
  return code >= 0xdc00 && code <= 0xdfff;
}

function embeddedCodeUnitBytes(code) {
  if (code === 34 || code === 92) return 4;
  if (code < 32)
    return code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 3 : 7;
  if (code < 128) return 1;
  if (code < 2048) return 2;
  if (code >= 0xd800 && code <= 0xdfff) return 7;
  return 3;
}

export function partitionEntityPageKeyBytes(key) {
  if (typeof key !== "string") throw new TypeError("Entity identity must be a string");
  let bytes = embeddedStringDelimiterBytes;
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && isTrailingSurrogate(key.charCodeAt(index + 1))) {
      bytes += 4;
      index += 1;
    } else bytes += embeddedCodeUnitBytes(code);
  }
  return bytes;
}

export function partitionEntityPageBytes(limits) {
  return Math.min(limits.pageBytes, limits.partitionBytes);
}

export function partitionEntityPageCapacity(limits) {
  return Math.min(
    PARTITION_ENTITY_DIRECTORY.maxEntries,
    Math.floor((partitionEntityPageBytes(limits) - fixedBytes) / entryBytes),
  );
}

export function partitionEntityPageCount(entries, capacity) {
  return Math.ceil(entries / capacity);
}

export function partitionProjectionPageReservation(limits, root, updates) {
  const capacity = partitionEntityPageCapacity(limits);

  let level = root === null ? 0 : root.level;
  let pages = 2 * level * updates;
  let rootEntries = 0;
  if (root !== null) rootEntries = level === 0 ? PARTITION_ENTITY_DIRECTORY.maxEntries : capacity;
  let children = partitionEntityPageCount(rootEntries + updates, capacity);
  pages += children;

  while (children > 1) {
    if (++level > PARTITION_ENTITY_DIRECTORY.maxLevel) return Infinity;
    children = partitionEntityPageCount(children, capacity);
    pages += children;
  }
  return pages;
}
