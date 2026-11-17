/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { immutableStorageError } from "./immutable-storage-error.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

export const IMMUTABLE_SEGMENT = Object.freeze({
  directory: "segments",
  bytes: 4 * 1024 * 1024,
  recordBytes: LENGTH_THRESHOLDS.immutableStorage.blockBytes,
  magic: "NOOBOT-SEGMENT-2\n",
  transactionReadHandles: 128,
});

export const IMMUTABLE_SEGMENT_CHECKPOINT_WORK = Object.freeze([
  "immutableHeadReadBytes",
  "immutableHeadWriteBytes",
  "immutableIndexPageReads",
  "immutableObjectReads",
  "immutableSegmentWrites",
  "immutableSegmentSyncs",
  "immutableReadBytes",
  "immutableWriteBytes",
]);

const NON_HEX = /[^a-f0-9]/;
const RECORD = /^([a-f0-9]+):(0|[1-9][0-9]*):(0|[1-9][0-9]*):([a-f0-9]+)$/;

function isHex(value, length) {
  return typeof value === "string" && value.length === length && !NON_HEX.test(value);
}

export function requireImmutableSegmentId(id) {
  if (!isHex(id, 32)) throw immutableStorageError("Invalid immutable segment identity");
  return id;
}

export function requireImmutableSegmentTail(tail) {
  if (tail === null) return tail;
  if (
    !tail ||
    Object.getPrototypeOf(tail) !== Object.prototype ||
    Object.keys(tail).length !== 2 ||
    !Object.hasOwn(tail, "segmentId") ||
    !Object.hasOwn(tail, "end") ||
    !Number.isSafeInteger(tail.end) ||
    tail.end < IMMUTABLE_SEGMENT.magic.length ||
    tail.end > IMMUTABLE_SEGMENT.bytes
  )
    throw immutableStorageError("Invalid committed segment tail");
  requireImmutableSegmentId(tail.segmentId);
  return tail;
}

export function immutableSegmentFileName(id) {
  return `${requireImmutableSegmentId(id)}.seg`;
}

export function immutableSegmentFileId(file) {
  const match = typeof file === "string" ? /^([a-f0-9]{32})\.seg$/.exec(file) : null;
  return match === null ? null : match[1];
}

export function requireImmutableContentDigest(digest) {
  if (!isHex(digest, 64)) throw immutableStorageError("Invalid immutable content digest");
  return digest;
}

function requireRecordRange(offset, length) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < IMMUTABLE_SEGMENT.magic.length ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > IMMUTABLE_SEGMENT.recordBytes ||
    offset + length > IMMUTABLE_SEGMENT.bytes
  )
    throw immutableStorageError("Invalid immutable record range");
}

function encodeRecordInSegment(segmentId, offset, length, digest) {
  requireImmutableContentDigest(digest);
  requireRecordRange(offset, length);
  return `${segmentId}:${offset}:${length}:${digest}`;
}

export function encodeImmutableRecordReference({ segmentId, offset, length, digest }) {
  return encodeRecordInSegment(requireImmutableSegmentId(segmentId), offset, length, digest);
}

export function createImmutableSegmentRecordEncoder(segmentId) {
  requireImmutableSegmentId(segmentId);
  return (offset, length, digest) => encodeRecordInSegment(segmentId, offset, length, digest);
}

export function decodeImmutableRecordReference(reference) {
  const match =
    typeof reference === "string" && reference.length >= 101 && reference.length <= 113
      ? RECORD.exec(reference)
      : null;

  if (
    !match ||
    match[0].length !== reference.length ||
    match[1].length !== 32 ||
    match[4].length !== 64
  )
    throw immutableStorageError("Invalid immutable record reference");
  const record = {
    segmentId: match[1],
    offset: Number(match[2]),
    length: Number(match[3]),
    digest: match[4],
  };
  requireRecordRange(record.offset, record.length);
  return record;
}

export function requireImmutableRecordReference(reference) {
  decodeImmutableRecordReference(reference);
  return reference;
}
