/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { partitionJournalError } from "./partition-journal.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";

export const PARTITION_CONTENT_CHUNK_BYTES =
  LENGTH_THRESHOLDS.partitionStorage.partitionContentChunkBytes;

const utf8 = new TextEncoder();

function jsonPointBytes(point) {
  const code = point.codePointAt(0);
  if (code < 0x20) return [8, 9, 10, 12, 13].includes(code) ? 2 : 6;
  if (code === 0x22 || code === 0x5c) return 2;
  if (code >= 0xd800 && code <= 0xdfff) return 6;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  return code > 0xffff ? 4 : 3;
}

export function splitPartitionContent(content) {
  if (typeof content !== "string")
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid message content chunk");
  const chunks = [];
  let start = 0;
  let byteLength = 0;
  let offset = 0;
  for (const point of content) {
    const size = jsonPointBytes(point);
    if (byteLength + size > PARTITION_CONTENT_CHUNK_BYTES) {
      chunks.push(content.slice(start, offset));
      start = offset;
      byteLength = 0;
    }
    byteLength += size;
    offset += point.length;
  }
  chunks.push(content.slice(start));
  return chunks;
}

export function encodePartitionContentChunk(content) {
  if (typeof content !== "string")
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid message content chunk");
  return utf8.encode(JSON.stringify(content).slice(1, -1));
}

export function encodePartitionContentRange(byteOffset, content) {
  const value = [byteOffset, content];
  requirePartitionContentRange(value, { contentBytes: Number.MAX_SAFE_INTEGER });
  return value;
}

export function requirePartitionContentBoundaries(record) {
  const { firstChunk, firstByteChunk, lastChunk, contentBytes } = record;
  if (
    !Number.isSafeInteger(firstChunk) ||
    !Number.isSafeInteger(lastChunk) ||
    firstChunk < 1 ||
    lastChunk < firstChunk ||
    !Number.isSafeInteger(contentBytes) ||
    contentBytes < 2 ||
    (contentBytes === 2
      ? firstByteChunk !== null || firstChunk !== lastChunk
      : !Number.isSafeInteger(firstByteChunk) ||
        firstByteChunk < firstChunk ||
        firstByteChunk > lastChunk)
  )
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Invalid partition message content boundaries",
    );
}

export function requirePartitionContentRange(value, record) {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    Object.keys(value).length !== 2 ||
    !Number.isSafeInteger(value[0]) ||
    value[0] < 1 ||
    typeof value[1] !== "string"
  )
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid message content range");
  const encoded = encodePartitionContentChunk(value[1]);
  if (
    encoded.byteLength > PARTITION_CONTENT_CHUNK_BYTES ||
    value[0] > record.contentBytes - 1 - encoded.byteLength
  )
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid message content range");
  return { byteOffset: value[0], byteLength: encoded.byteLength, content: value[1], encoded };
}

export function advancePartitionContentRange(range, offset, contentBytes, last) {
  const end = offset + range.byteLength;
  if (range.byteOffset !== offset || (last && end !== contentBytes - 1))
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Non-contiguous message content");
  return end;
}

export function partitionContentAppendNeedsBoundary(appended) {
  if (typeof appended !== "string")
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid message content boundary");
  const first = appended.charCodeAt(0);
  return first >= 0xdc00 && first <= 0xdfff;
}

export function partitionContentAppendBoundary(previous, appended) {
  if (typeof previous !== "string" || typeof appended !== "string")
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid message content boundary");
  const last = previous.charCodeAt(previous.length - 1);
  const joinsSurrogates =
    last >= 0xd800 && last <= 0xdbff && partitionContentAppendNeedsBoundary(appended);
  return joinsSurrogates
    ? { previous: previous.slice(0, -1), appended: previous.slice(-1) + appended }
    : { previous, appended };
}
