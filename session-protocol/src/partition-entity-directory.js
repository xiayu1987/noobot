/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { Buffer } from "node:buffer";
import { storageBytesDigest } from "#storage-digest";
import { deepFreeze, isDeepFrozen } from "@noobot/shared/deep-freeze";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { PARTITION_HISTORICAL_OPERATIONS } from "./partition-collection-names.js";
import {
  partitionEntityKey,
  requirePartitionEntityOwner,
  requirePartitionEntityReference,
} from "./partition-transaction.js";
import {
  decodePartitionJournalControl,
  encodePartitionJournalControl,
  requireEntityDirectoryPosition,
} from "./partition-journal.js";

import {
  PARTITION_ENTITY_DIRECTORY,
  PARTITION_ENTITY_DIRECTORY_FORMAT,
  partitionEntityPageCapacity,
  requirePartitionEntityPageKey,
} from "./partition-entity-page-budget.js";

export {
  PARTITION_ENTITY_DIRECTORY,
  PARTITION_ENTITY_DIRECTORY_FORMAT,
  PARTITION_ENTITY_PAGE_CODEC,
  partitionEntityPageBytes,
  partitionEntityPageCapacity,
  partitionEntityPageCount,
} from "./partition-entity-page-budget.js";

const verifiedNodes = new WeakMap();
const verifiedEntries = new WeakMap();

function fields(value, names) {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== names.length ||
    names.some((name) => !Object.hasOwn(value, name))
  )
    throw new TypeError("Invalid entity directory fields");
}

export function partitionEntityUpdateSequence({ owner, reference }) {
  const { sequence } = reference.record;
  return owner.sequence < sequence ? sequence : 0;
}

export function partitionEntityNodeMaxUpdateSequence(node) {
  const verified = verifiedNodes.get(node);
  if (verified) return verified.maxUpdateSequence;
  const { level, entries } = node;
  let max = 0;
  for (const entry of entries)
    max = Math.max(max, level ? entry[2] : partitionEntityUpdateSequence(entry[1]));
  return max;
}

function requireLeafReference(entry, head) {
  const [collection, key] = JSON.parse(entry[0]);
  if (partitionEntityKey(collection, key) !== entry[0])
    throw new TypeError("Invalid entity directory key");
  fields(entry[1], ["owner", "reference"]);
  const owner = requirePartitionEntityOwner(entry[1].owner, head.sequence);
  if (owner.epoch !== head.epoch) throw new TypeError("Entity owner belongs to another journal");
  requirePartitionEntityReference(entry[1].reference, head);
  const { record, slot } = entry[1].reference;
  if (
    owner.partition > record.partition ||
    owner.sequence > record.sequence ||
    (owner.sequence === record.sequence &&
      (owner.partition !== record.partition || owner.slot !== slot))
  )
    throw new TypeError("Entity owner exceeds its mutation boundary");
}

function historicalDigest(key) {
  const [collection, digest] = JSON.parse(key);
  if (
    collection !== PARTITION_HISTORICAL_OPERATIONS ||
    typeof digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    partitionEntityKey(collection, digest) !== key
  )
    throw new TypeError("Invalid historical directory key");
  return digest;
}

const historicalDigestLength = 64;

export function partitionHistoricalDirectorySlot(identity, prefix) {
  const digest = historicalDigest(identity);
  if (prefix.length >= digest.length || !digest.startsWith(prefix))
    throw new TypeError("Historical directory key does not match its digest prefix");
  return digest[prefix.length];
}

export function partitionHistoricalDirectoryMatches(identity, prefix) {
  return historicalDigest(identity).startsWith(prefix);
}

export function partitionHistoricalDirectorySharedPrefix(identities, prefix, anchor) {
  const digests = identities.map(historicalDigest);
  const first = anchor ?? digests[0];
  let end = first.length;
  for (const digest of digests) {
    if (!digest.startsWith(prefix))
      throw new TypeError("Historical directory digest prefix mismatch");
    let index = prefix.length;
    while (index < end && digest[index] === first[index]) index += 1;
    end = index;
  }
  return first.slice(0, end);
}

export function requirePartitionHistoricalDirectoryPath(node, prefix) {
  if (
    node.historical !== true ||
    (node.level === 1
      ? !node.sharedPrefix.startsWith(prefix)
      : !partitionHistoricalDirectoryMatches(node.entries[0][0], prefix))
  )
    throw new TypeError("Historical directory page does not match its digest prefix");
}

function requireChildReference(entry, head) {
  requireEntityDirectoryPosition(entry[1]);
  if (!Number.isSafeInteger(entry[2]) || entry[2] < 0 || entry[2] > head.sequence)
    throw new TypeError("Invalid entity directory child update sequence");
}

function validateEntry(entry, { level, historical }, head, decoded) {
  const verified = verifiedEntries.get(entry);
  if (
    verified &&
    verified.level === level &&
    verified.historical === historical &&
    verified.epoch === head.epoch &&
    verified.sequence <= head.sequence &&
    verified.partition <= head.tail.partition
  )
    return verified;

  if (historical) {
    if (!level) historicalDigest(entry[0]);
    else if (!/^[a-f0-9]$/.test(entry[0])) throw new TypeError("Invalid historical directory slot");
  }
  if (level) {
    requirePartitionEntityPageKey(entry[0]);
    requireChildReference(entry, head);
  } else requireLeafReference(entry, head);
  const updateSequence = level ? entry[2] : partitionEntityUpdateSequence(entry[1]);
  if (historical && updateSequence !== 0)
    throw new TypeError("Historical directory cannot contain updates");
  const proof = {
    epoch: head.epoch,
    level,
    historical,
    sequence: level ? entry[2] : entry[1].reference.record.sequence,
    partition: level ? 0 : entry[1].reference.record.partition,
    updateSequence,
  };
  if (decoded) sealDecodedDirectoryEntry(entry, level);
  if (decoded || isDeepFrozen(entry)) verifiedEntries.set(entry, proof);
  return proof;
}

function directoryNodeEntryLimit(level, historical, limits) {
  if (historical) return level === 1 ? historicalSlots : 1;
  return level > 0 ? partitionEntityPageCapacity(limits) : PARTITION_ENTITY_DIRECTORY.maxEntries;
}

function requireDirectoryNodeShape(node, head) {
  const historical = Object.hasOwn(node, "historical");
  const historicalBranch = historical && node.level === 1;
  fields(
    node,
    historical
      ? [
          "format",
          "epoch",
          "level",
          "entries",
          "historical",
          ...(historicalBranch ? ["sharedPrefix"] : []),
        ]
      : ["format", "epoch", "level", "entries"],
  );
  if (
    node.format !== PARTITION_ENTITY_DIRECTORY_FORMAT ||
    (historical && node.historical !== true) ||
    node.epoch !== head.epoch ||
    !Number.isSafeInteger(node.level) ||
    node.level < 0 ||
    node.level > (historical ? 1 : PARTITION_ENTITY_DIRECTORY.maxLevel) ||
    !Array.isArray(node.entries) ||
    node.entries.length < (historicalBranch ? 2 : 1) ||
    (historicalBranch && !validHistoricalSharedPrefix(node.sharedPrefix)) ||
    node.entries.length > directoryNodeEntryLimit(node.level, historical, head.limits)
  )
    throw new TypeError("Invalid entity directory node");
  return { level: node.level, historical };
}

export function requireEntityDirectoryNode(node, head) {
  return validateDirectoryNode(node, head, false);
}

function validateDirectoryNode(node, head, decoded) {
  const verified = verifiedNodes.get(node);
  if (
    verified &&
    head.epoch === verified.epoch &&
    head.sequence >= verified.sequence &&
    head.tail.partition >= verified.partition &&
    (!node.level || partitionEntityPageCapacity(head.limits) >= verified.capacity)
  )
    return node;
  const kind = requireDirectoryNodeShape(node, head);
  let previous = null;
  let maxUpdateSequence = 0;
  let sequence = 0;
  let partition = 0;
  for (const entry of node.entries) {
    if (
      !Array.isArray(entry) ||
      entry.length !== (node.level ? 3 : 2) ||
      typeof entry[0] !== "string" ||
      (previous !== null && previous >= entry[0])
    )
      throw new TypeError("Invalid entity directory ordering");
    previous = entry[0];
    const proof = validateEntry(entry, kind, head, decoded);
    maxUpdateSequence = Math.max(maxUpdateSequence, proof.updateSequence);
    sequence = Math.max(sequence, proof.sequence);
    partition = Math.max(partition, proof.partition);
  }
  if (decoded) {
    Object.freeze(node.entries);
    Object.freeze(node);
  }
  if (decoded || isDeepFrozen(node))
    verifiedNodes.set(node, {
      epoch: head.epoch,
      sequence,
      partition,
      capacity: kind.level && !kind.historical ? node.entries.length : 0,
      maxUpdateSequence,
    });
  return node;
}

function encodeLeafReference({ owner, reference }) {
  const { record, slot } = reference;
  const location = [record.partition, record.sequence, slot];
  if (owner.sequence !== record.sequence)
    location.push(owner.partition, owner.sequence, owner.slot);
  return location;
}

export const PARTITION_HISTORICAL_PAGE_CODEC = 2;
const digestBytes = historicalDigestLength / 2;
const historicalSlots = 16;
const historicalChecksumBytes = LENGTH_THRESHOLDS.immutableStorage.historicalDirectoryChecksumBytes;
const historicalBitmapBytes = Uint16Array.BYTES_PER_ELEMENT;
const historicalPointerFieldCount = 3;
const historicalMinimumPositionBytes =
  1 + 1 + historicalBitmapBytes + historicalPointerFieldCount + historicalChecksumBytes;

function validHistoricalSharedPrefix(prefix) {
  return (
    typeof prefix === "string" &&
    prefix.length < historicalDigestLength &&
    /^[a-f0-9]*$/.test(prefix)
  );
}

function appendUnsigned(bytes, number) {
  if (!Number.isSafeInteger(number) || number < 0)
    throw new TypeError("Invalid historical pointer");
  while (number >= 128) {
    bytes.push((number % 128) + 128);
    number = Math.floor(number / 128);
  }
  bytes.push(number);
}

function readUnsigned(readByte) {
  let value = 0;
  for (let index = 0; index < 8; index += 1) {
    const byte = readByte();
    value += (byte % 128) * 128 ** index;
    if (byte >= 128) continue;
    if ((index && !byte) || !Number.isSafeInteger(value))
      throw new TypeError("Noncanonical historical pointer");
    return value;
  }
  throw new TypeError("Invalid historical pointer");
}

function historicalPointerWidth(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid historical pointer");
  const high = Math.floor(value / 2 ** 32);
  return high ? 64 - Math.clz32(high) : 32 - Math.clz32(value);
}

function historicalPointerLayout(pointers) {
  return [0, 1, 2].map((field) => {
    const values = pointers.map((pointer) => pointer[field]);
    const base = Math.min(...values);
    const max = Math.max(...values);
    const width = historicalPointerWidth(max);
    const deltaWidth = historicalPointerWidth(max - base);
    const baseBytes = Math.ceil(historicalPointerWidth(base) / 7);
    return base && baseBytes * 8 < (width - deltaWidth) * pointers.length
      ? { base, width: deltaWidth }
      : { base: 0, width };
  });
}

function visitHistoricalPointerByteChunks(width, bitOffset, visit) {
  for (let shift = 0; shift < width;) {
    const start = bitOffset % 8;
    const size = Math.min(width - shift, 8 - start);
    visit(Math.floor(bitOffset / 8), start, 2 ** size, 2 ** shift);
    bitOffset += size;
    shift += size;
  }
  return bitOffset;
}

function encodeHistoricalPointers(pointers) {
  const layout = historicalPointerLayout(pointers);
  const bits = layout.reduce((sum, { width }) => sum + width, 0) * pointers.length;
  const packed = Buffer.alloc(Math.ceil(bits / 8));
  const header = layout.map(({ base, width }) => width | (base ? 128 : 0));
  for (const { base } of layout) if (base) appendUnsigned(header, base);
  let offset = 0;
  for (const pointer of pointers) {
    for (const [field, value] of pointer.entries()) {
      const { base, width } = layout[field];
      offset = visitHistoricalPointerByteChunks(width, offset, (byte, start, radix, factor) => {
        packed[byte] |= (Math.floor((value - base) / factor) % radix) << start;
      });
    }
  }
  return [...header, ...packed];
}

function decodeHistoricalPointers(payload, slots, readByte, take) {
  if (slots.length < 2) throw new TypeError("Invalid historical directory pointer layout");
  const tags = [readByte(), readByte(), readByte()];
  const layout = tags.map((tag) => {
    const width = tag & 127;
    const base = tag & 128 ? readUnsigned(readByte) : 0;
    if (width > 53 || (!base && tag & 128))
      throw new TypeError("Invalid historical directory pointer layout");
    return { base, width };
  });
  const bits = layout.reduce((sum, { width }) => sum + width, 0) * slots.length;
  const start = take(Math.ceil(bits / 8));
  let offset = 0;
  const pointers = slots.map(() =>
    layout.map(({ base, width }) => {
      let value = 0;
      offset = visitHistoricalPointerByteChunks(width, offset, (byte, shift, radix, factor) => {
        value += ((payload[start + byte] >>> shift) % radix) * factor;
      });
      return base + value;
    }),
  );
  if (
    (bits % 8 && payload[start + Math.floor(bits / 8)] >>> (bits % 8)) ||
    historicalPointerLayout(pointers).some(
      ({ base, width }, field) => base !== layout[field].base || width !== layout[field].width,
    )
  )
    throw new TypeError("Noncanonical historical directory pointer layout");
  return pointers;
}

function historicalPageDigest(epoch, payload) {
  return storageBytesDigest(Buffer.concat([Buffer.from(epoch, "hex"), payload])).slice(
    0,
    historicalChecksumBytes * 2,
  );
}

const historicalLeafTag = 0;

function encodeHistoricalBranch(entries, sharedPrefix) {
  let slots = 0;
  if (!validHistoricalSharedPrefix(sharedPrefix) || entries.length < 2)
    throw new TypeError("Invalid historical directory page shape");
  const bytes = [
    sharedPrefix.length + 1,
    0,
    0,
    ...Buffer.from(sharedPrefix.padEnd(Math.ceil(sharedPrefix.length / 2) * 2, "0"), "hex"),
  ];
  let previousSlot = -1;
  const pointers = [];
  for (const [key, entry, sequence] of entries) {
    const slot = Number.parseInt(key, 16);
    if (
      sequence !== 0 ||
      key !== slot.toString(16) ||
      slot <= previousSlot ||
      slot >= historicalSlots
    )
      throw new TypeError("Invalid historical directory child");
    previousSlot = slot;
    slots |= 1 << slot;
    requireEntityDirectoryPosition(entry);
    pointers.push([entry.segment, entry.offset, entry.bytes - historicalMinimumPositionBytes]);
  }
  bytes[1] = slots & 255;
  bytes[2] = slots >>> 8;
  bytes.push(...encodeHistoricalPointers(pointers));
  return bytes;
}

function encodeHistoricalLeaf(entries) {
  if (entries.length !== 1) throw new TypeError("Invalid historical directory page shape");
  const [[key, entry]] = entries;
  const pointer = encodeLeafReference(entry);
  if (pointer.length !== historicalPointerFieldCount)
    throw new TypeError("Historical directory cannot contain updates");
  const bytes = [historicalLeafTag, ...Buffer.from(historicalDigest(key), "hex")];
  for (const value of pointer) appendUnsigned(bytes, value);
  return bytes;
}

export function encodePartitionHistoricalDirectoryPage({ epoch, level, entries, sharedPrefix }) {
  if (level !== 0 && level !== 1) throw new TypeError("Invalid historical directory page shape");
  const payload = Buffer.from(
    level === 1 ? encodeHistoricalBranch(entries, sharedPrefix) : encodeHistoricalLeaf(entries),
  );
  return Buffer.concat([payload, Buffer.from(historicalPageDigest(epoch, payload), "hex")]);
}

function historicalOccupiedSlots(bitmap) {
  const occupied = [];
  for (let slot = 0; slot < historicalSlots; slot += 1) {
    if (bitmap & (1 << slot)) occupied.push(slot);
  }
  return occupied;
}

export function decodePartitionHistoricalDirectoryPage(bytes, head) {
  if (bytes.length < 1 + historicalChecksumBytes)
    throw new TypeError("Truncated historical directory page");
  const payload = bytes.subarray(0, -historicalChecksumBytes);
  const { epoch } = head;
  if (
    historicalPageDigest(epoch, payload) !==
    bytes.subarray(-historicalChecksumBytes).toString("hex")
  )
    throw new TypeError("Historical directory integrity check failed");
  let offset = 0;
  function take(length) {
    if (offset + length > payload.length)
      throw new TypeError("Truncated historical directory entry");
    const start = offset;
    offset += length;
    return start;
  }
  const readByte = () => payload[take(1)];
  const tag = readByte();
  const level = Number(tag !== historicalLeafTag);
  const readPointer = () =>
    Array.from({ length: historicalPointerFieldCount }, () => readUnsigned(readByte));
  const entries = [];
  const node = {
    format: PARTITION_ENTITY_DIRECTORY_FORMAT,
    epoch,
    level,
    entries,
    historical: true,
  };
  if (level) {
    const prefixLength = tag - 1;
    if (prefixLength >= historicalDigestLength)
      throw new TypeError("Invalid historical directory prefix length");
    const slots = payload.readUInt16LE(take(historicalBitmapBytes));
    const start = take(Math.ceil(prefixLength / 2));
    const packed = payload.subarray(start, offset).toString("hex");
    if (prefixLength % 2 && !packed.endsWith("0"))
      throw new TypeError("Noncanonical historical directory prefix");
    node.sharedPrefix = packed.slice(0, prefixLength);
    const occupied = historicalOccupiedSlots(slots);
    const pointers = decodeHistoricalPointers(payload, occupied, readByte, take);
    for (const [index, slot] of occupied.entries()) {
      const [segment, childOffset, bytes] = pointers[index];
      entries.push([
        slot.toString(16),
        { segment, offset: childOffset, bytes: bytes + historicalMinimumPositionBytes },
        0,
      ]);
    }
  } else {
    const start = take(digestBytes);
    const key = partitionEntityKey(
      PARTITION_HISTORICAL_OPERATIONS,
      payload.subarray(start, offset).toString("hex"),
    );
    entries.push([key, decodeLeafReference(epoch, readPointer())]);
  }
  if (offset !== payload.length) throw new TypeError("Trailing historical directory bytes");
  return validateDirectoryNode(node, head, true);
}

export function encodePartitionEntityDirectoryPage({ epoch, level, entries, historical }) {
  if (historical !== undefined) throw new TypeError("Historical page requires its own codec");
  return encodePartitionJournalControl([
    epoch,
    level,
    entries.map((entry) => encodeDirectoryEntry(level, entry)),
  ]);
}

function decodeLeafReference(
  epoch,
  [partition, sequence, slot, createdPartition, createdSequence, createdSlot],
) {
  const record = { epoch, partition, sequence };
  const reference = { record, slot };
  if (createdSequence === undefined) return { owner: { ...record, slot }, reference };
  if (createdSequence === sequence) throw new TypeError("Redundant entity owner encoding");
  return {
    owner: { epoch, partition: createdPartition, sequence: createdSequence, slot: createdSlot },
    reference,
  };
}

function encodeDirectoryEntry(level, [key, entry, updateSequence]) {
  return [
    key,
    level ? [entry.segment, entry.offset, entry.bytes, updateSequence] : encodeLeafReference(entry),
  ];
}

function decodeDirectoryEntry(level, epoch, entry) {
  if (
    !Array.isArray(entry) ||
    entry.length !== 2 ||
    !Array.isArray(entry[1]) ||
    !(level ? entry[1].length === 4 : [3, 6].includes(entry[1].length))
  )
    throw new TypeError("Invalid entity directory entry encoding");
  const [key, pointer] = entry;
  if (!level) return [key, decodeLeafReference(epoch, pointer)];
  const [segment, offset, bytes, sequence] = pointer;
  return [key, { segment, offset, bytes }, sequence];
}

function sealDecodedDirectoryEntry(entry, level) {
  const pointer = entry[1];
  if (level === 0) {
    Object.freeze(pointer.owner);
    Object.freeze(pointer.reference.record);
    Object.freeze(pointer.reference);
  }
  Object.freeze(pointer);
  Object.freeze(entry);
}

export function decodePartitionEntityDirectoryPage(serialized, head) {
  const page = decodePartitionJournalControl(serialized);
  if (
    !Array.isArray(page) ||
    page.length !== 3 ||
    !Number.isSafeInteger(page[1]) ||
    page[1] < 0 ||
    !Array.isArray(page[2])
  )
    throw new TypeError("Invalid entity directory page");
  const [epoch, level, wireEntries] = page;
  const entries = wireEntries.map((entry) => decodeDirectoryEntry(level, epoch, entry));
  return validateDirectoryNode(
    {
      format: PARTITION_ENTITY_DIRECTORY_FORMAT,
      epoch,
      level,
      entries,
    },
    head,
    true,
  );
}

const maxDeltaEntries = 4;

export function encodePartitionEntityPageDelta(base, previous, next) {
  if (previous.historical || next.historical || previous.level !== next.level)
    throw new TypeError("Entity page delta and base must have the same level");
  const changes = [];
  let i = 0;
  let j = 0;
  while (i < previous.entries.length || j < next.entries.length) {
    const before = previous.entries[i];
    const after = next.entries[j];
    if (before === after) {
      i += 1;
      j += 1;
    } else if (!before || (after && after[0] < before[0])) {
      changes.push(encodeDirectoryEntry(next.level, after));
      j += 1;
    } else if (!after || before[0] < after[0]) {
      changes.push(encodeDirectoryRemoval(next.level, before[0]));
      i += 1;
    } else {
      changes.push(encodeDirectoryEntry(next.level, after));
      i += 1;
      j += 1;
    }
    if (changes.length > maxDeltaEntries) return null;
  }
  if (!changes.length) return null;
  return encodePartitionJournalControl([
    [base.segment, base.offset, base.bytes],
    next.level,
    changes,
  ]);
}

function encodeDirectoryRemoval(level, key) {
  if (level === 0) throw new TypeError("Entity leaf delta cannot remove a key");
  return [key, null];
}

export function decodePartitionEntityPageDelta(serialized, head, position) {
  const wire = decodePartitionJournalControl(serialized);
  if (!Array.isArray(wire) || wire.length !== 3 || !Array.isArray(wire[0]) || wire[0].length !== 3)
    throw new TypeError("Invalid entity page delta");
  const [[segment, offset, bytes], level, changes] = wire;
  const base = requireEntityDirectoryPosition({ segment, offset, bytes });
  if (
    segment > position.segment ||
    (segment === position.segment && offset + bytes > position.offset)
  )
    throw new TypeError("Entity page delta base must precede the delta");
  if (
    !Number.isSafeInteger(level) ||
    level < 0 ||
    level > PARTITION_ENTITY_DIRECTORY.maxLevel ||
    !Array.isArray(changes) ||
    changes.length === 0 ||
    changes.length > maxDeltaEntries
  )
    throw new TypeError("Invalid entity page delta entries");
  let previous = null;
  const entries = changes.map((change) => {
    if (
      !Array.isArray(change) ||
      change.length !== 2 ||
      typeof change[0] !== "string" ||
      (previous !== null && previous >= change[0]) ||
      (level === 0 && change[1] === null)
    )
      throw new TypeError("Invalid entity page delta entry");
    previous = change[0];
    return change[1] === null ? change : decodeDirectoryEntry(level, head.epoch, change);
  });
  return deepFreeze({ base, level, entries });
}

export function applyPartitionEntityPageDelta(base, delta, head) {
  if (base.historical || base.level !== delta.level)
    throw new TypeError("Entity page delta and base must have the same level");
  const entries = [];
  let slot = 0;
  for (const change of delta.entries) {
    while (slot < base.entries.length && base.entries[slot][0] < change[0])
      entries.push(base.entries[slot++]);
    if (base.entries[slot]?.[0] === change[0]) slot += 1;
    else if (change[1] === null) throw new TypeError("Delta removes a missing entry");
    if (change[1] !== null) entries.push(change);
  }
  while (slot < base.entries.length) entries.push(base.entries[slot++]);
  return requireEntityDirectoryNode(deepFreeze({ ...base, entries }), head);
}
