/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  PARTITION_CONTENT_CHUNK_BYTES,
  encodePartitionContentChunk,
  encodePartitionContentRange,
  partitionContentAppendBoundary,
  partitionContentAppendNeedsBoundary,
  requirePartitionContentBoundaries,
  requirePartitionContentRange,
  splitPartitionContent,
} from "@noobot/session-protocol/partition-message-content";
import {
  PARTITION_MESSAGE_COLLECTIONS,
  partitionMessageEntryKey,
} from "@noobot/session-protocol/partition-session-messages";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { createMessageContentPage } from "@noobot/session-protocol/message-read-budget";

const contentCollection = PARTITION_MESSAGE_COLLECTIONS.content;

function corrupt(message) {
  throw partitionJournalError("SESSION_STORAGE_CORRUPT", message);
}

function contentKey(messageUid, ordinal) {
  return partitionMessageEntryKey(contentCollection, messageUid, ordinal);
}

export function partitionContentMutations(messageUid, ordinal, content, byteOffset) {
  return splitPartitionContent(content).map((chunk, index) => {
    const key = contentKey(messageUid, ordinal + index);
    if (!Number.isSafeInteger(ordinal + index)) corrupt("Invalid content chunk ordinal");
    const value = encodePartitionContentRange(byteOffset, chunk);
    byteOffset += encodePartitionContentChunk(chunk).byteLength;
    return { collection: contentCollection, key, value, owner: null };
  });
}

async function prepareAppendBoundary(view, record, content) {
  const messageUid = record.message.messageUid;
  const mutations = [];
  let byteOffset = record.contentBytes - 1;
  let firstByteChunk = record.firstByteChunk;
  if (!partitionContentAppendNeedsBoundary(content))
    return { mutations, byteOffset, firstByteChunk, content };
  const key = contentKey(messageUid, record.lastChunk);
  const range = (await view.getLatestMany({ collection: contentCollection, keys: [key] })).get(key);
  if (!range || range.mutation.remove) corrupt("Missing message content tail");
  const descriptor = requirePartitionContentRange(range.mutation.value, record);
  if (descriptor.byteOffset + descriptor.byteLength !== byteOffset)
    corrupt("Message content tail disagrees with its range");
  const boundary = partitionContentAppendBoundary(descriptor.content, content);
  if (boundary.previous !== descriptor.content) {
    const rewritten = partitionContentMutations(
      messageUid,
      record.lastChunk,
      boundary.previous,
      descriptor.byteOffset,
    );
    rewritten[0].owner = range.owner;
    mutations.push(...rewritten);
    byteOffset = descriptor.byteOffset + encodePartitionContentChunk(boundary.previous).byteLength;
    content = boundary.appended;
    if (firstByteChunk === record.lastChunk && !boundary.previous.length) firstByteChunk = null;
  }
  return { mutations, byteOffset, firstByteChunk, content };
}

export async function preparePartitionContentWrite(view, record, content, replacement) {
  if (!replacement && !content.length) return { fields: {}, mutations: [] };
  const ordinal = record.lastChunk + 1;
  if (!Number.isSafeInteger(ordinal)) corrupt("Invalid content chunk ordinal");
  const messageUid = record.message.messageUid;
  const prepared = replacement
    ? { mutations: [], byteOffset: 1, firstByteChunk: null, content }
    : await prepareAppendBoundary(view, record, content);
  const { mutations, byteOffset, firstByteChunk } = prepared;
  content = prepared.content;
  const added = partitionContentMutations(messageUid, ordinal, content, byteOffset);
  mutations.push(...added);
  const contentBytes = byteOffset + encodePartitionContentChunk(content).byteLength + 1;
  if (!Number.isSafeInteger(contentBytes)) corrupt("Invalid message content length");
  return {
    fields: {
      firstChunk: replacement ? ordinal : record.firstChunk,
      firstByteChunk: firstByteChunk ?? (content.length ? ordinal : null),
      lastChunk: ordinal + added.length - 1,
      contentBytes,
    },
    mutations,
  };
}

async function readRange(read, record, ordinal) {
  const key = contentKey(record.message.messageUid, ordinal);
  const entry = (await read({ collection: contentCollection, keys: [key] })).get(key);
  const range = requirePartitionContentRange(entry?.value, record);
  if (ordinal === record.firstByteChunk && (range.byteOffset !== 1 || range.byteLength === 0))
    corrupt("Message byte index disagrees with its content");
  if (
    (ordinal === record.firstChunk && range.byteOffset !== 1) ||
    (ordinal === record.lastChunk &&
      range.byteOffset + range.byteLength !== record.contentBytes - 1)
  )
    corrupt("Message content range disagrees with its boundary");
  return range;
}

async function locateRange(read, record, byteOffset) {
  let lower = record.firstByteChunk;
  let upper = record.lastChunk;
  let start = 1;
  let end = record.contentBytes - 1;
  let probes = 0;
  while (lower <= upper && byteOffset >= start && byteOffset < end) {
    const firstPossible = lower + Math.floor((byteOffset - start) / PARTITION_CONTENT_CHUNK_BYTES);
    const lastPossible = upper - Math.floor((end - 1 - byteOffset) / PARTITION_CONTENT_CHUNK_BYTES);
    if (firstPossible > lastPossible) break;
    const boundary = byteOffset - start < end - 1 - byteOffset ? firstPossible : lastPossible;
    const ordinal =
      probes < 2 ? boundary : firstPossible + Math.floor((lastPossible - firstPossible) / 2);
    probes += 1;
    const range = await readRange(read, record, ordinal);
    const stop = range.byteOffset + range.byteLength;
    if (range.byteOffset < start || stop > end) corrupt("Overlapping message content ranges");
    if (byteOffset < range.byteOffset) {
      upper = ordinal - 1;
      end = range.byteOffset;
    } else if (byteOffset >= stop) {
      lower = ordinal + 1;
      start = stop;
    } else return { ordinal, range };
  }
  corrupt("Message byte offset is not covered by its chunk ranges");
}

export async function readPartitionContentRange(read, record, { byteOffset, maxBytes }) {
  requirePartitionContentBoundaries(record);
  if (byteOffset > record.contentBytes)
    throw new RangeError("Value range starts beyond its content");
  const end = byteOffset + Math.min(maxBytes, record.contentBytes - byteOffset);
  const bytes = new Uint8Array(end - byteOffset);
  if (record.contentBytes === 2 && bytes.length > 0)
    await readRange(read, record, record.firstChunk);
  if (byteOffset === 0 && end > 0) bytes[0] = 0x22;
  if (end === record.contentBytes && end > byteOffset) bytes[bytes.length - 1] = 0x22;
  const position = Math.max(1, byteOffset);
  const bodyEnd = Math.min(end, record.contentBytes - 1);
  if (position < bodyEnd)
    await copyContentRanges(read, record, { bytes, byteOffset, position, bodyEnd });
  return bytes;
}

async function copyContentRanges(read, record, { bytes, byteOffset, position, bodyEnd }) {
  let { ordinal, range } = await locateRange(read, record, position);
  while (position < bodyEnd) {
    if (range.byteOffset > position || range.byteOffset + range.byteLength < position)
      corrupt("Discontinuous message content range");
    const { encoded } = range;
    const stop = Math.min(bodyEnd, range.byteOffset + range.byteLength);
    bytes.set(
      encoded.subarray(position - range.byteOffset, stop - range.byteOffset),
      position - byteOffset,
    );
    position = stop;
    if (position === bodyEnd) break;
    ordinal += 1;
    if (ordinal > record.lastChunk) corrupt("Incomplete message content range");
    range = await readRange(read, record, ordinal);
    if (range.byteOffset !== position) corrupt("Discontinuous message content range");
  }
}

export async function readPartitionContentBytes(read, record, selection, generation) {
  const bytes = await readPartitionContentRange(read, record, selection);
  return createMessageContentPage({
    generation,
    selection,
    contentReference: record.contentVersion,
    totalBytes: record.contentBytes,
    bytes,
  });
}
