/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { Buffer } from "node:buffer";
import { storageDigest } from "#storage-digest";
import { immutableStorageError } from "./immutable-storage-error.js";
import { isPlainObject } from "@noobot/shared/value";
import { IMMUTABLE_VALUE_BLOCK_BYTES } from "./immutable-value-limits.js";
import {
  createImmutableSegmentRecordEncoder,
  decodeImmutableRecordReference,
} from "./immutable-segment.js";

function compareLocationEntries([a], [b]) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

const EMPTY_LOCATION_LEAF_BYTES = Buffer.byteLength(
  JSON.stringify({ kind: "index-leaf", entries: [] }),
);

export function immutableLocationPageByteLength(page) {
  if (page.kind === "index-branch") return Buffer.byteLength(JSON.stringify(page));
  if (page.kind !== "index-leaf") throw immutableStorageError("Invalid location page kind");
  let bytes = EMPTY_LOCATION_LEAF_BYTES - 1;
  for (const [key, reference] of page.entries) bytes += key.length + reference.length + 8;
  return bytes;
}

export function requireImmutableLocationPagePath(page, prefix) {
  if (typeof prefix !== "string" || !/^[a-f0-9]{0,64}$/.test(prefix))
    throw immutableStorageError("Invalid location index path");
  if (page.kind === "index-leaf") {
    for (const [key] of page.entries) {
      if (prefix.length && !storageDigest(key).startsWith(prefix))
        throw immutableStorageError("Location leaf key does not belong to its hash path");
    }
    if (immutableLocationPageByteLength(page) > IMMUTABLE_VALUE_BLOCK_BYTES)
      throw immutableStorageError("Invalid location index leaf size");
  } else if (page.kind !== "index-branch" || page.depth !== prefix.length) {
    throw immutableStorageError("Location branch does not belong to its hash path");
  }
  return page;
}

function requireLocationKey(key, previous, leaf) {
  if (
    typeof key !== "string" ||
    (previous !== null && key <= previous) ||
    (!leaf && !/^[a-f0-9]$/.test(key))
  )
    throw immutableStorageError("Invalid or unordered location page key");
}

export function encodeImmutableLocationPage(page) {
  const leaf = page?.kind === "index-leaf";
  if (!leaf && page?.kind !== "index-branch")
    throw immutableStorageError("Invalid location page kind");
  const segments = [];
  const positions = new Map();
  if (
    !leaf &&
    (!isPlainObject(page.children) ||
      !Number.isSafeInteger(page.depth) ||
      page.depth < 0 ||
      page.depth >= 64)
  )
    throw immutableStorageError("Invalid location branch");
  const entries = leaf ? page.entries : Object.entries(page.children).sort(compareLocationEntries);
  if (!Array.isArray(entries) || !entries.length)
    throw immutableStorageError("Empty location page");
  if (entries.length > IMMUTABLE_VALUE_BLOCK_BYTES / 64)
    throw immutableStorageError("Location page exceeds its record budget");
  let previous = null;
  const rows = entries.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2)
      throw immutableStorageError("Invalid location page entry");
    const [key, reference] = entry;
    requireLocationKey(key, previous, leaf);
    previous = key;
    const { segmentId, offset, length, digest } = decodeImmutableRecordReference(reference);
    if (!positions.has(segmentId)) {
      positions.set(segmentId, segments.length);
      segments.push(segmentId);
    }
    if (leaf && key !== digest) throw immutableStorageError("Location leaf identity mismatch");
    return leaf
      ? [key, positions.get(segmentId), offset, length]
      : [key, positions.get(segmentId), offset, length, digest];
  });
  const bytes = Buffer.from(
    JSON.stringify(["noobot.location-page/1", leaf ? null : page.depth, segments, rows]),
  );
  if (bytes.length > IMMUTABLE_VALUE_BLOCK_BYTES)
    throw immutableStorageError("Location page exceeds its byte budget");
  return bytes;
}

export function decodeImmutableLocationPage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > IMMUTABLE_VALUE_BLOCK_BYTES)
    throw immutableStorageError("Invalid or oversized location page bytes");
  const text = bytes.toString("utf8");
  let encoded;
  try {
    encoded = JSON.parse(text);
  } catch (cause) {
    throw immutableStorageError("Invalid location page encoding", cause);
  }
  if (
    !Array.isArray(encoded) ||
    encoded.length !== 4 ||
    encoded[0] !== "noobot.location-page/1" ||
    !Array.isArray(encoded[2]) ||
    !Array.isArray(encoded[3])
  )
    throw immutableStorageError("Invalid location page envelope");
  const depth = encoded[1];
  const segments = encoded[2];
  const rows = encoded[3];
  const leaf = depth === null;
  if (!leaf && (!Number.isInteger(depth) || depth < 0 || depth >= 64))
    throw immutableStorageError("Invalid location page depth");
  if (!rows.length || rows.length > IMMUTABLE_VALUE_BLOCK_BYTES / 64)
    throw immutableStorageError("Invalid location page record budget");
  const positions = new Map();
  const encoders = segments.map(createImmutableSegmentRecordEncoder);
  let previous = null;
  const entries = rows.map((row) => {
    if (!Array.isArray(row) || row.length !== (leaf ? 4 : 5))
      throw immutableStorageError("Invalid location page row");
    const [key, segment, offset, length] = row;
    if (!Number.isInteger(segment) || segment < 0 || segment >= segments.length)
      throw immutableStorageError("Invalid location page slot");
    requireLocationKey(key, previous, leaf);
    previous = key;
    const segmentId = segments[segment];
    if (!positions.has(segmentId)) positions.set(segmentId, positions.size);
    if (positions.get(segmentId) !== segment)
      throw immutableStorageError("Noncanonical location page segment table");
    return [key, encoders[segment](offset, length, leaf ? key : row[4])];
  });
  const page = leaf
    ? { kind: "index-leaf", entries }
    : { kind: "index-branch", depth, children: Object.fromEntries(entries) };

  if (positions.size !== segments.length || JSON.stringify(encoded) !== text)
    throw immutableStorageError("Noncanonical location page encoding");
  return page;
}
