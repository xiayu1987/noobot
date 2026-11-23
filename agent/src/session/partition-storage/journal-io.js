/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import {
  PARTITION_COLLECTION_FRAME,
  PARTITION_JOURNAL_DIRECTORIES,
  PARTITION_JOURNAL_FRAME,
  PARTITION_JOURNAL_HEAD_FILE,
  PARTITION_JOURNAL_PUBLICATION_LOCK,
  decodePartitionCollectionFrameSlot,
  decodePartitionJournalFrameRequest,
  decodePartitionJournalHead,
  encodePartitionJournalControl,
  partitionCollectionFrameBodyStart,
  partitionCollectionSlotOffset,
  partitionJournalBodyDigest,
  partitionJournalError,
  partitionJournalPathParts,
  requirePartitionJournalHead,
  requirePartitionCollectionFrameSlot,
} from "@noobot/session-protocol/partition-journal";
import {
  requirePartitionMutationIdentity,
  requirePartitionTransaction,
} from "@noobot/session-protocol/partition-transaction";
import { fsLstat, fsMkdir, fsOpen } from "../../shared/storage/fs-adapter.js";
import { syncStorageDirectory, withStorageCleanup } from "../../shared/storage/durable-file.js";
import {
  discardJournalFileStage,
  installJournalFile,
  replaceJournalFile,
} from "./journal-file-publication.js";
import {
  initializeJournalPublicationLock,
  withJournalPublicationLock,
} from "./journal-publication-lock.js";

export function journalHeadPath(root) {
  return path.join(root, PARTITION_JOURNAL_HEAD_FILE);
}

const { headerBytes, lengthBytes, trailer } = PARTITION_JOURNAL_FRAME;

export class CommittedJournalDamage extends Error {
  constructor(message, options) {
    super(message, options);
    this.code = "SESSION_STORAGE_CORRUPT";
  }
}

export async function openCommittedJournalFile(file, description, flags = "r") {
  try {
    return await fsOpen(file, flags);
  } catch (cause) {
    if (cause.code !== "ENOENT") throw cause;
    throw new CommittedJournalDamage(`Committed partition ${description} is missing`, { cause });
  }
}

function journalPartitionsDirectory(root) {
  return path.join(root, PARTITION_JOURNAL_DIRECTORIES.partitions);
}

export function journalCatalogDirectory(root) {
  return path.join(root, PARTITION_JOURNAL_DIRECTORIES.catalog);
}

export function journalRetentionsDirectory(root) {
  return path.join(root, PARTITION_JOURNAL_DIRECTORIES.retentions);
}

export function journalPartitionPath(root, partition) {
  return path.join(
    journalPartitionsDirectory(root),
    ...partitionJournalPathParts(partition),
    "records.log",
  );
}

export function encodeJournalFrame(payload) {
  const digest = partitionJournalBodyDigest(payload);
  const frame = Buffer.alloc(headerBytes + payload.length + Buffer.byteLength(trailer));
  frame.writeUInt32BE(payload.length);
  frame.set(Buffer.from(digest, "hex"), lengthBytes);
  frame.set(payload, headerBytes);
  frame.write(trailer, headerBytes + payload.length, "ascii");
  return { frame, digest };
}

export async function readJournalBytes(handle, { length, offset, work, readBudget }) {
  readBudget?.consume(length);
  const bytes = Buffer.alloc(length);
  let consumed = 0;
  while (consumed < length) {
    const result = await handle.read(bytes, consumed, length - consumed, offset + consumed);
    work.readBytes += result.bytesRead;
    if (result.bytesRead === 0)
      throw new CommittedJournalDamage("Committed journal range is truncated");
    consumed += result.bytesRead;
  }
  return bytes;
}

function decodeJournalFrameHeader(header, { offset, end, limits, remainingBytes }) {
  const length = header.readUInt32BE(0);
  const frameBytes = headerBytes + length + Buffer.byteLength(trailer);
  if (frameBytes > limits.transactionBytes || offset + frameBytes > end)
    throw new CommittedJournalDamage("Committed journal frame exceeds its boundary");
  if (frameBytes > remainingBytes) return null;
  return { length, frameBytes };
}

async function readJournalFramePrefix(handle, range, prefixBytes) {
  const { offset, end, work, remainingBytes, readBudget } = range;
  if (remainingBytes < headerBytes) return null;
  if (offset + prefixBytes > end)
    throw new CommittedJournalDamage("Committed journal header is truncated");
  return readJournalBytes(handle, { length: prefixBytes, offset, work, readBudget });
}

export async function readJournalFrame(handle, { publication, ...range }) {
  const prefix = await readJournalFramePrefix(handle, range, headerBytes);
  if (prefix === null) return null;
  const header = decodeJournalFrameHeader(prefix, range);
  if (header === null) return null;
  const { length, frameBytes } = header;
  const digest = prefix.subarray(lengthBytes).toString("hex");
  const { offset, work, readBudget } = range;
  const body = await readJournalBytes(handle, {
    length: length + Buffer.byteLength(trailer),
    offset: offset + headerBytes,
    work,
    readBudget,
  });
  if (
    body.subarray(length).toString("latin1") !== trailer ||
    digest !== partitionJournalBodyDigest(body.subarray(0, length))
  )
    throw new CommittedJournalDamage("Committed journal integrity check failed");
  let request;
  try {
    request = decodePartitionJournalFrameRequest(body.subarray(0, length), publication);
    if (publication === "collections")
      requirePartitionTransaction(request.payload, request.sequence);
  } catch (cause) {
    throw new CommittedJournalDamage("Invalid committed journal request", { cause });
  }
  return { request, digest, bytes: frameBytes };
}

function decodeSlotEntries(table, { layout, length, previousEnd }) {
  const { slotBytes } = PARTITION_COLLECTION_FRAME;
  const entries = [];
  for (let index = 0; index < table.length / slotBytes; index += 1) {
    const entry = decodeCommittedSlot("Invalid journal slot table", () =>
      requirePartitionCollectionFrameSlot(
        table.subarray(index * slotBytes, (index + 1) * slotBytes),
        layout.envelopeStart,
        length,
      ),
    );
    if (index === 0 ? entry.offset < previousEnd : entry.offset !== previousEnd)
      throw new CommittedJournalDamage("Invalid journal slot order");
    previousEnd = entry.offset + entry.length;
    entries.push(entry);
  }
  return { entries, previousEnd };
}

function decodeCommittedSlot(message, decode) {
  try {
    return decode();
  } catch (cause) {
    throw new CommittedJournalDamage(message, { cause });
  }
}

function decodeSlotRecords(body, { entries, offset, firstSlot, position, layout }, records) {
  for (const [index, entry] of entries.entries()) {
    const slot = firstSlot + index;
    const first = entry.offset - offset;
    const mutation = decodeCommittedSlot("Invalid committed journal mutation", () => {
      const decoded = decodePartitionCollectionFrameSlot({
        bytes: body.subarray(first, first + entry.length),
        request: position,
        layout,
        slot,
        position: entry,
      });
      requirePartitionMutationIdentity(decoded, position.sequence);
      return decoded;
    });
    records.set(slot, { mutation, encodedBytes: entry.length });
  }
}

export async function readJournalFrameSlots(handle, { range, position, slots, validatedFrame }) {
  const read = (bytes, offset) =>
    readJournalBytes(handle, {
      length: bytes,
      offset: range.offset + headerBytes + offset,
      work: range.work,
      readBudget: range.readBudget,
    });
  const { countBytes, slotBytes } = PARTITION_COLLECTION_FRAME;
  let frame = validatedFrame;
  if (!frame) {
    const prefix = await readJournalFramePrefix(handle, range, headerBytes + countBytes);
    if (prefix === null) return null;
    const header = decodeJournalFrameHeader(prefix, range);
    if (header === null) return null;
    const { length, frameBytes } = header;
    const footer = await read(trailer.length, length);
    if (footer.toString("latin1") !== trailer || length < countBytes)
      throw new CommittedJournalDamage("Invalid journal collection boundary");
    const layout = decodeCommittedSlot("Invalid journal collection layout", () =>
      partitionCollectionFrameBodyStart(prefix.subarray(headerBytes), length),
    );
    frame = { length, frameBytes, layout };
  }
  const { length, frameBytes, layout } = frame;
  const selected = [...new Set(slots)].sort((a, b) => a - b);
  for (const slot of selected) {
    if (!Number.isSafeInteger(slot) || slot < 0 || slot >= layout.count)
      throw partitionJournalError(
        "SESSION_STORAGE_IDENTITY",
        "Entity reference slot exceeds transaction",
      );
  }
  const slotRecords = new Map();
  let previousEnd = layout.envelopeStart;
  for (let start = 0; start < selected.length;) {
    let end = start + 1;
    while (end < selected.length && selected[end] === selected[end - 1] + 1) end += 1;
    const firstSlot = selected[start];
    const table = await read((end - start) * slotBytes, partitionCollectionSlotOffset(firstSlot));
    const decoded = decodeSlotEntries(table, { layout, length, previousEnd });
    const { entries } = decoded;
    previousEnd = decoded.previousEnd;
    const offset = entries[0].offset;
    const body = await read(previousEnd - offset, offset);
    decodeSlotRecords(body, { entries, offset, firstSlot, position, layout }, slotRecords);
    start = end;
  }
  return { bytes: frameBytes, slotRecords, frame };
}

export async function clampJournalTail(handle, committedBytes) {
  const { size } = await handle.stat();
  if (size < committedBytes)
    throw new CommittedJournalDamage("Published storage tail is truncated");
  if (size > committedBytes) await handle.truncate(committedBytes);
}

export async function restoreDurableTail(file, committedBytes, description) {
  if (committedBytes === 0) return;
  const handle = await openCommittedJournalFile(file, description, "r+");
  await withStorageCleanup(
    async () => {
      await clampJournalTail(handle, committedBytes);

      await handle.sync();
    },
    () => handle.close(),
  );
}

export async function writeJournalBytes(handle, bytes, offset, work) {
  let written = 0;
  while (written < bytes.length) {
    const result = await handle.write(bytes, written, bytes.length - written, offset + written);
    if (result.bytesWritten === 0) throw new Error("Journal write made no progress");
    written += result.bytesWritten;
    work.writeBytes += result.bytesWritten;
  }
}

export async function prepareJournalDirectory(durableAncestor, directory) {
  const relative = path.relative(durableAncestor, directory);
  if (relative === "") return;
  const entries = relative.split(path.sep);
  if (entries[0] === ".." || path.isAbsolute(relative))
    throw new TypeError("Journal directory must be inside its durable ancestor");
  await fsMkdir(directory, { recursive: true });

  let parent = path.dirname(directory);
  for (let depth = 0; depth < entries.length; depth += 1) {
    await syncStorageDirectory(parent);
    parent = path.dirname(parent);
  }
}

export async function readJournalHead(root, work, decode = decodePartitionJournalHead) {
  const handle = await fsOpen(journalHeadPath(root), "r");
  return withStorageCleanup(
    async () => {
      const { size } = await handle.stat();
      if (size > PARTITION_JOURNAL_FRAME.controlBytes)
        throw new CommittedJournalDamage("Journal control file exceeds its bound");
      const bytes = await readJournalBytes(handle, { length: size, offset: 0, work });
      try {
        return decode(bytes);
      } catch (cause) {
        if (cause.code !== "SESSION_STORAGE_CORRUPT") throw cause;
        throw new CommittedJournalDamage("Invalid journal control record", { cause });
      }
    },
    () => handle.close(),
  );
}

async function writeJournalHead(root, head, work, install) {
  requirePartitionJournalHead(head);
  const bytes = Buffer.from(encodePartitionJournalControl(head));
  if (bytes.length > PARTITION_JOURNAL_FRAME.controlBytes)
    throw new RangeError("Journal control file exceeds its protocol budget");
  await install(journalHeadPath(root), bytes);
  work.controlWriteBytes += bytes.length;
  work.publications += 1;
}

async function journalPathExists(file) {
  try {
    await fsLstat(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function initializeJournalHead(root, head, work) {
  const current = journalHeadPath(root);
  await validateEmptyJournal(root, current);
  const lock = path.join(root, PARTITION_JOURNAL_PUBLICATION_LOCK);
  await initializeJournalPublicationLock(root, lock);
  return withJournalPublicationLock(lock, async () => {
    await validateEmptyJournal(root, current);
    await discardJournalFileStage(current);
    return writeJournalHead(root, head, work, installJournalFile);
  });
}

async function validateEmptyJournal(root, current) {
  if (await journalPathExists(current))
    throw partitionJournalError("EEXIST", "Journal CURRENT already exists");
  for (const directory of [
    journalPartitionsDirectory,
    journalCatalogDirectory,
    journalRetentionsDirectory,
  ]) {
    if (!(await journalPathExists(directory(root)))) continue;

    if (await journalPathExists(current))
      throw partitionJournalError("EEXIST", "Journal CURRENT already exists");
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Journal has storage without CURRENT");
  }
}

export function discardUnpublishedJournalHead(root) {
  return discardJournalFileStage(journalHeadPath(root));
}

export function publishJournalHead(journal, head) {
  return writeJournalHead(journal.root, head, journal.work, (file, bytes) =>
    replaceJournalFile(file, bytes, () => {
      if (journal.failure) throw journal.failure;
    }),
  );
}
