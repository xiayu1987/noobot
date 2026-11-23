/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isObjectLike } from "@noobot/shared/value";
import { partitionJournalError } from "./errors.js";

export const LIFECYCLE_INDEX_PATH_WIDTH = 309;
export const LIFECYCLE_INDEX_DESCRIPTOR = Object.freeze({
  collection: "metadata",
  key: "lifecycleIndex",
});
export const LIFECYCLE_INDEX_ORDER = "lifecycleOrder";
const nodePrefix = "p:";
export const lifecycleIndexNodeKey = (path) => nodePrefix + path;

export function isLifecycleIndexPath(value) {
  return (
    typeof value === "string" && value.length <= LIFECYCLE_INDEX_PATH_WIDTH && !/[^01]/.test(value)
  );
}

function invalidPath() {
  return partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid lifecycle index path encoding");
}

function pack(path) {
  if (!isLifecycleIndexPath(path)) throw invalidPath();
  const lengthPreservingBits = `0b1${path}`;
  return BigInt(lengthPreservingBits).toString(16);
}

function unpack(encoded) {
  if (
    typeof encoded !== "string" ||
    encoded.length > Math.ceil((LIFECYCLE_INDEX_PATH_WIDTH + 1) / 4) ||
    !/^[1-9a-f]/.test(encoded) ||
    /[^0-9a-f]/.test(encoded)
  )
    throw invalidPath();
  const path = BigInt(`0x${encoded}`).toString(2).slice(1);
  if (!isLifecycleIndexPath(path)) throw invalidPath();
  return path;
}

function transcodeRecord(value, convert, node) {
  if (!isObjectLike(value) || Object.getPrototypeOf(value) !== Object.prototype)
    throw invalidPath();
  const fields = Object.getOwnPropertyDescriptors(value);
  function field(name) {
    const descriptor = Object.hasOwn(fields, name) && fields[name];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw invalidPath();
    return descriptor;
  }
  function convertField(name) {
    const descriptor = field(name);
    descriptor.value = convert(descriptor.value);
  }
  if (node) {
    convertField("prefix");
    if (field("kind").value === "branch") {
      convertField("zero");
      convertField("one");
    }
  } else {
    const root = field("root");
    if (root.value !== null) root.value = convert(root.value);
  }
  return Object.create(Object.prototype, fields);
}

function transcode(collection, key, value, convert) {
  if (collection === LIFECYCLE_INDEX_ORDER) {
    if (typeof key !== "string" || !key.startsWith(nodePrefix)) throw invalidPath();
    const nextKey = lifecycleIndexNodeKey(convert(key.slice(nodePrefix.length)));
    if (value === undefined) return [nextKey, value];
    return [nextKey, transcodeRecord(value, convert, true)];
  }
  if (
    collection === LIFECYCLE_INDEX_DESCRIPTOR.collection &&
    key === LIFECYCLE_INDEX_DESCRIPTOR.key &&
    value !== undefined
  )
    return [key, transcodeRecord(value, convert, false)];
  return [key, value];
}

export const encodeLifecycleIndexPaths = (collection, key, value) =>
  transcode(collection, key, value, pack);
export const decodeLifecycleIndexPaths = (collection, key, value) =>
  transcode(collection, key, value, unpack);
