/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepStrictEqual } from "node:util";
import { storageBytesDigest } from "#storage-digest";
export { storageDigest as partitionJournalRequestDigest } from "#storage-digest";
export const PARTITION_CHECKPOINT_JOURNAL_WORK = Object.freeze([
  "readBytes",
  "writeBytes",
  "controlWriteBytes",
  "dataSyncs",
  "publications",
  "partitionOpens",
]);
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { encodeBoundedJournalJson, parseFrozenJournalJson } from "./partition-journal-json.js";
import {
  PARTITION_COLLECTION_NAMES,
  PARTITION_MESSAGE_CONTENT,
} from "./partition-collection-names.js";
import { exactObject, positive } from "./partition-journal-fields.js";
import { isPartitionEpoch, partitionEpochOctets } from "./partition-epoch.js";
export { partitionEpochOctets } from "./partition-epoch.js";
import { encodeJournalKey, decodeJournalKeyJson } from "./partition-journal-key-codec.js";
import { decodeLifecycleIndexPaths, encodeLifecycleIndexPaths } from "./lifecycle-index-path.js";
import {
  partitionTransactionPosition,
  requirePartitionTransactionPosition,
} from "./partition-transaction-position.js";
import {
  requireSessionRequestDigest,
  SESSION_REQUEST_DIGEST_BYTES,
} from "./session-request-digest.js";
import { partitionJournalError } from "./errors.js";
export { createSessionJournalRetirementError, partitionJournalError } from "./errors.js";
import { decodePartitionJournalControl } from "./partition-journal-control.js";
export {
  decodePartitionJournalControl,
  encodePartitionJournalControl,
} from "./partition-journal-control.js";
import { requireEntityDirectoryHead } from "./partition-journal-directory.js";
export {
  EMPTY_SEALED_COLLECTION,
  decodePartitionJournalDirectory,
  encodePartitionJournalDirectory,
  requireEntityDirectoryPosition,
  requirePublishedEntityDirectoryPosition,
  requireEntityDirectoryHead,
  partitionJournalPathParts,
  requirePartitionJournalDirectory,
  requireLocalPartitionReference,
} from "./partition-journal-directory.js";
import {
  emptyJournalState,
  requireCollectionPageCapacity,
  requirePartitionJournalLimits,
} from "./partition-journal-budget.js";
export {
  requirePartitionJournalLimits,
  requirePartitionSessionStorageBudget,
} from "./partition-journal-budget.js";
import { journalDigestBytes, PARTITION_JOURNAL_FRAME } from "./partition-journal-frame-layout.js";
export { PARTITION_JOURNAL_FRAME } from "./partition-journal-frame-layout.js";
import {
  PartitionAdmissionRejection,
  partitionEntityProjectionFits,
  partitionJournalHasCapacity,
} from "./partition-journal-capacity.js";
export {
  PartitionAdmissionRejection,
  PartitionProjectionBackpressure,
  finishPartitionEntityProjection,
  partitionEntityProjectionFits,
  partitionEntityUnpublishedSegmentBudget,
  partitionJournalBatchBudget,
  partitionTransactionSubmissionRecords,
  partitionJournalHasCapacity,
  partitionJournalReservedBytes,
  partitionJournalReservedInodes,
  requirePartitionEntityPublicationExtent,
  requirePartitionPublicationCapacity,
  requiresImmediatePartitionProjection,
} from "./partition-journal-capacity.js";

export const PARTITION_JOURNAL_FORMAT = "noobot.partition-journal-prototype/96";
export const PARTITION_JOURNAL_PUBLICATION_LOCK = "publication.lock";
export const PARTITION_SNAPSHOT_FORMAT = "noobot.partition-snapshot/1";
export const PARTITION_SNAPSHOT_OWNERSHIP_DIRECTORY = "retention-owners";
export { PARTITION_JOURNAL_HEAD_FILE } from "./partition-journal-fields.js";

export function decodePartitionJournalHead(bytes) {
  if (bytes.length > PARTITION_JOURNAL_FRAME.controlBytes)
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Journal control file exceeds its bound",
    );
  try {
    return requirePartitionJournalHead(decodePartitionJournalControl(bytes.toString("utf8")));
  } catch (cause) {
    throw Object.assign(
      partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid journal control record"),
      { cause },
    );
  }
}

export const PARTITION_JOURNAL_DIRECTORIES = Object.freeze({
  partitions: "partitions",
  catalog: "catalog",
  retentions: "retentions",
  retentionOwners: PARTITION_SNAPSHOT_OWNERSHIP_DIRECTORY,
});
export const PARTITION_COLLECTION_PUBLICATION = "partition-collections";
export const PARTITION_SESSION_PUBLICATION = "collections";
const PUBLICATION_PARTICIPANTS = Object.freeze({
  journal: Object.freeze([]),
  collections: Object.freeze([PARTITION_COLLECTION_PUBLICATION]),
});

export function partitionJournalPublicationParticipants(publication) {
  if (typeof publication !== "string" || !Object.hasOwn(PUBLICATION_PARTICIPANTS, publication))
    throw new TypeError("Unknown journal publication protocol");
  return PUBLICATION_PARTICIPANTS[publication];
}
export function partitionSnapshotFailure(phase, cause, snapshot) {
  requirePartitionJournalHead(snapshot);
  if (phase === "acquire")
    return Object.assign(
      partitionJournalError(
        "SESSION_SNAPSHOT_UNCERTAIN",
        "Snapshot acquisition failed; release the attached snapshot before reclaiming",
      ),
      { cause, snapshot },
    );
  if (phase === "release")
    return Object.assign(
      partitionJournalError(
        "SESSION_SNAPSHOT_RELEASE_UNCERTAIN",
        "Snapshot cleanup failed; retry release with the attached snapshot",
      ),
      { cause, snapshot },
    );
  throw new TypeError("Unknown snapshot failure phase");
}

export function assertPartitionSessionJournalPolicy(head, expectedLimits) {
  const limits = requirePartitionJournalLimits(expectedLimits);
  if (head.publication !== PARTITION_SESSION_PUBLICATION || !isDeepStrictEqual(head.limits, limits))
    throw partitionJournalError(
      "SESSION_STORAGE_POLICY_MISMATCH",
      "Journal publication mode or limits do not match the target session storage policy",
    );
}

export function partitionJournalRecoveryReadLimit(head) {
  return (
    PARTITION_JOURNAL_FRAME.controlBytes +
    (head.tail.partition - head.receiptStart.partition) * PARTITION_JOURNAL_FRAME.directoryBytes +
    (head.sequence - head.receiptStart.sequence + 1) * PARTITION_JOURNAL_FRAME.offsetBytes +
    head.limits.receiptBytes
  );
}

export function requirePartitionJournalCursor(cursor) {
  exactObject(cursor, ["partition", "offset", "sequence"], "partition journal cursor");
  for (const [key, value] of Object.entries(cursor))
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid cursor ${key}`);
  return cursor;
}

export function requirePartitionRequestPosition({ epoch, sequence }) {
  if (!isPartitionEpoch(epoch)) throw new TypeError("Invalid partition journal request epoch");
  positive(sequence, "request sequence");
}

export function requirePartitionJournalRequest(request) {
  exactObject(request, ["epoch", "sequence", "payload"], "partition journal request");
  requirePartitionRequestPosition(request);
  if (request.payload === undefined) throw new TypeError("Request payload must be JSON");
  return request;
}

export function partitionJournalBodyDigest(bytes) {
  return storageBytesDigest(bytes);
}

export function requirePartitionJournalReference(reference, head) {
  exactObject(reference, ["epoch", "partition", "sequence"], "partition journal reference");
  positive(reference.sequence, "reference sequence");
  if (!Number.isSafeInteger(reference.partition) || reference.partition < 0)
    throw new TypeError("Invalid reference partition");
  if (reference.epoch !== head.epoch)
    throw partitionJournalError("SESSION_STORAGE_IDENTITY", "Reference belongs to another journal");
  if (reference.sequence > head.sequence || reference.partition > head.tail.partition)
    throw new RangeError("Reference exceeds snapshot publication boundary");
  return reference;
}

export function createPartitionJournalReference(head, receipt) {
  return Object.freeze(
    requirePartitionJournalReference(
      {
        epoch: head.epoch,
        partition: receipt.cursor.partition,
        sequence: receipt.sequence,
      },
      head,
    ),
  );
}

function transactionBudgetError() {
  return new PartitionAdmissionRejection(
    "SESSION_TRANSACTION_BUDGET",
    "Transaction exceeds journal budget",
  );
}

export function partitionTransactionJsonBudget(limits) {
  return {
    budget:
      limits.transactionBytes -
      PARTITION_JOURNAL_FRAME.headerBytes -
      PARTITION_JOURNAL_FRAME.trailer.length,
    budgetError: transactionBudgetError,
  };
}

export function serializePartitionTransactionValue(value, limits) {
  return encodeBoundedJournalJson(value, {
    ...partitionTransactionJsonBudget(limits),
    maxDepth: PARTITION_JOURNAL_FRAME.maxJsonDepth,
  });
}

export function encodePartitionJournalRequest(request, limits) {
  const serialized = serializePartitionTransactionValue(request, limits);
  return { serialized, request: requirePartitionJournalRequest(JSON.parse(serialized)) };
}

const slotIntegerBytes = Uint32Array.BYTES_PER_ELEMENT;
const slotBytes = 2 * slotIntegerBytes + journalDigestBytes;
const utf8 = new TextEncoder();
const decodeUtf8 = new TextDecoder("utf-8", { fatal: true });
const packedSlot = 0;
const maxSlotExpansion = 8;
const standaloneSlotWireDictionary = utf8.encode(
  "display:deps:display:row:display:statisticsdisplay:presentation:display:order:" +
    "display:assistant-count:assistantsassistantpresentation-messageuserMessageUidcontextCandidateskeys00000000000000" +
    '"15":"message","17":[],"14":"assistant","41":"","67":"","68":"","69":"","70":"","46":false' +
    '"24":1,"25":{"26":[1]}',
);

function frameCorrupt() {
  return partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid journal collection frame");
}

function slotDigest({ epoch, sequence }, { count, bodyBytes }, { slot, offset, bytes }) {
  const prefix = utf8.encode(`${epoch}:${sequence}:${count}:${bodyBytes}:${slot}:${offset}:`);
  const input = new Uint8Array(prefix.length + bytes.length);
  input.set(prefix);
  input.set(bytes, prefix.length);
  return storageBytesDigest(input);
}

function encodeSlotBytes(text, compress) {
  const raw = utf8.encode(text);
  if (!compress || raw.length < 32) return raw;
  const packed = deflateRawSync(raw, { dictionary: standaloneSlotWireDictionary });
  const length = packed.length + 1;
  if (length >= raw.length || raw.length > length * maxSlotExpansion) return raw;
  const bytes = new Uint8Array(length);
  bytes[0] = packedSlot;
  bytes.set(packed, 1);
  return bytes;
}

function decodeSlotText(bytes) {
  if (bytes[0] !== packedSlot) return decodeUtf8.decode(bytes);
  const { buffer, engine } = inflateRawSync(bytes.subarray(1), {
    dictionary: standaloneSlotWireDictionary,
    maxOutputLength: bytes.length * maxSlotExpansion,
    info: true,
  });
  if (engine.bytesWritten !== bytes.length - 1 || buffer.length <= bytes.length)
    throw frameCorrupt();
  return decodeUtf8.decode(buffer);
}

export const PARTITION_COLLECTION_FRAME = Object.freeze({
  countBytes: slotIntegerBytes,
  slotBytes,
});

function requireFrameFields(value, fields, label) {
  exactObject(value, fields, label);
  if (
    Reflect.ownKeys(value).length !== fields.length ||
    fields.some((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      return !descriptor.enumerable || !Object.hasOwn(descriptor, "value");
    })
  )
    throw new TypeError(`Invalid ${label} data properties`);
}

const mutationValueSlot = 2;
const mutationOwnerFieldCount = 3;

function mutationOwnerStart(tuple) {
  const removalFields = mutationValueSlot;
  const writeFields = mutationValueSlot + 1;
  switch (tuple.length) {
    case removalFields:
    case removalFields + mutationOwnerFieldCount:
      return removalFields;
    case writeFields:
    case writeFields + mutationOwnerFieldCount:
      return writeFields;
    default:
      throw frameCorrupt();
  }
}

function encodeCollectionMutation(mutation, budget, epoch) {
  const removing = Object.hasOwn(mutation, "remove");
  requireFrameFields(
    mutation,
    ["collection", "key", "owner", removing ? "remove" : "value"],
    "collection mutation",
  );
  const { collection, key, owner, remove, value } = mutation;
  if (removing && remove !== true) throw new TypeError("Invalid collection removal");
  if (owner !== null)
    requireFrameFields(owner, ["epoch", "partition", "sequence", "slot"], "mutation owner");
  if (owner !== null && owner.epoch !== epoch)
    throw new PartitionAdmissionRejection(
      "SESSION_STORAGE_IDENTITY",
      "Mutation owner belongs to another journal epoch",
    );
  const collectionId = PARTITION_COLLECTION_NAMES.indexOf(collection);
  if (collectionId < 0) throw new TypeError("Unknown partition collection");
  const [wireKey, wireValue] = encodeLifecycleIndexPaths(collection, key, value);
  const compress = collection !== PARTITION_MESSAGE_CONTENT;
  const tuple = [collectionId, wireKey];
  if (!removing) tuple.push(wireValue);
  if (owner !== null) tuple.push(owner.partition, owner.sequence, owner.slot);
  const text = encodeBoundedJournalJson(tuple, {
    budget: compress ? budget * maxSlotExpansion : budget,
    maxDepth: PARTITION_JOURNAL_FRAME.maxJsonDepth - 3,
    budgetError: transactionBudgetError,
    encodeKey: encodeJournalKey,
  });
  const bytes = encodeSlotBytes(text, compress);
  if (bytes.length > budget) {
    const error = transactionBudgetError();
    error.collection = collection;
    error.encodedBytes = bytes.length;
    error.remainingBytes = budget;
    throw error;
  }
  return { text, bytes };
}

function decodeCollectionMutation(text, epoch) {
  const tuple = decodeJournalKeyJson(text);
  if (!Array.isArray(tuple)) throw frameCorrupt();
  const ownerStart = mutationOwnerStart(tuple);
  const removing = ownerStart === mutationValueSlot;
  const [collectionId, wireKey] = tuple;
  if (
    !Number.isSafeInteger(collectionId) ||
    collectionId < 0 ||
    collectionId >= PARTITION_COLLECTION_NAMES.length
  )
    throw frameCorrupt();
  const collection = PARTITION_COLLECTION_NAMES[collectionId];
  const [key, value] = decodeLifecycleIndexPaths(
    collection,
    wireKey,
    removing ? undefined : tuple[mutationValueSlot],
  );
  const owner =
    tuple.length === ownerStart
      ? null
      : {
          epoch,
          partition: tuple[ownerStart],
          sequence: tuple[ownerStart + 1],
          slot: tuple[ownerStart + 2],
        };
  return removing ? { collection, key, owner, remove: true } : { collection, key, owner, value };
}

const collectionEnvelopePrefixBytes = partitionEpochOctets + SESSION_REQUEST_DIGEST_BYTES;

function decodeCollectionEnvelope(bytes) {
  if (bytes.length <= collectionEnvelopePrefixBytes) throw frameCorrupt();
  const epoch = bytesToHex(bytes.subarray(0, partitionEpochOctets));
  const requestDigest = bytesToHex(
    bytes.subarray(partitionEpochOctets, collectionEnvelopePrefixBytes),
  );
  const tuple = JSON.parse(decodeUtf8.decode(bytes.subarray(collectionEnvelopePrefixBytes)));
  if (!Array.isArray(tuple) || tuple.length !== 3) throw frameCorrupt();
  const [sequence, operationId, result] = tuple;
  requirePartitionRequestPosition({ epoch, sequence });
  return {
    epoch,
    sequence,
    payload: { ...partitionTransactionPosition(sequence), operationId, requestDigest, result },
  };
}

function encodePartitionCollectionFrame(request, limits) {
  requireFrameFields(request, ["epoch", "sequence", "payload"], "journal request");
  requirePartitionRequestPosition(request);
  requireFrameFields(
    request.payload,
    ["format", "expectedGeneration", "operationId", "requestDigest", "mutations", "result"],
    "collection transaction",
  );
  requirePartitionTransactionPosition(request.payload, request.sequence);
  const { mutations, operationId, requestDigest, result } = request.payload;
  requireSessionRequestDigest(requestDigest);
  if (!Array.isArray(mutations) || Object.getPrototypeOf(mutations) !== Array.prototype)
    throw new TypeError("Collection mutations require a plain array");
  const count = mutations.length;
  let remaining =
    limits.transactionBytes -
    PARTITION_JOURNAL_FRAME.headerBytes -
    PARTITION_JOURNAL_FRAME.trailer.length -
    partitionCollectionSlotOffset(count) -
    collectionEnvelopePrefixBytes;
  if (remaining < 0) throw transactionBudgetError();
  if (Reflect.ownKeys(mutations).length !== count + 1)
    throw new TypeError("Collection mutations cannot carry extra properties or holes");
  const envelope = utf8.encode(
    encodeBoundedJournalJson([request.sequence, operationId, result], {
      budget: remaining,
      maxDepth: PARTITION_JOURNAL_FRAME.maxJsonDepth,
      budgetError: transactionBudgetError,
    }),
  );
  remaining -= envelope.length;
  const values = [];
  for (let slot = 0; slot < count; slot += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(mutations, String(slot));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value"))
      throw new TypeError("Collection mutations require own data properties");
    const value = encodeCollectionMutation(descriptor.value, remaining, request.epoch);
    remaining -= value.bytes.length;
    values.push(value);
  }
  const envelopeStart = partitionCollectionSlotOffset(count);
  let offset = envelopeStart + collectionEnvelopePrefixBytes + envelope.length;
  const bodyBytes = values.reduce((total, { bytes }) => total + bytes.length, offset);
  const body = new Uint8Array(bodyBytes);
  const table = new DataView(body.buffer);
  table.setUint32(0, count);
  body.set(hexToBytes(request.epoch), envelopeStart);
  body.set(hexToBytes(requestDigest), envelopeStart + partitionEpochOctets);
  body.set(envelope, envelopeStart + collectionEnvelopePrefixBytes);
  for (const [slot, { bytes }] of values.entries()) {
    const start = partitionCollectionSlotOffset(slot);
    table.setUint32(start, offset);
    table.setUint32(start + slotIntegerBytes, bytes.length);
    body.set(
      hexToBytes(slotDigest(request, { count, bodyBytes }, { slot, offset, bytes })),
      start + 2 * slotIntegerBytes,
    );
    body.set(bytes, offset);
    offset += bytes.length;
  }
  const captured = decodeCollectionEnvelope(
    body.subarray(envelopeStart, envelopeStart + collectionEnvelopePrefixBytes + envelope.length),
  );
  captured.payload.mutations = values.map(({ text }) =>
    decodeCollectionMutation(text, captured.epoch),
  );
  return { request: captured, body, encodedSlotBytes: values.map(({ bytes }) => bytes.length) };
}

export function encodePartitionJournalFrameRequest(request, limits, publication) {
  if (publication === "journal") {
    const encoded = encodePartitionJournalRequest(request, limits);
    return { request: encoded.request, body: utf8.encode(encoded.serialized) };
  }
  if (publication !== "collections") throw new TypeError("Unknown journal publication protocol");
  return encodePartitionCollectionFrame(request, limits);
}

export function partitionCollectionSlotOffset(slot) {
  return slotIntegerBytes + slot * slotBytes;
}

export function partitionCollectionFrameBodyStart(countBuffer, bodyBytes) {
  if (countBuffer.length !== slotIntegerBytes) throw frameCorrupt();
  const count = new DataView(
    countBuffer.buffer,
    countBuffer.byteOffset,
    countBuffer.byteLength,
  ).getUint32(0);
  const envelopeStart = partitionCollectionSlotOffset(count);
  if (envelopeStart >= bodyBytes) throw frameCorrupt();
  return { count, envelopeStart, bodyBytes };
}

export function requirePartitionCollectionFrameSlot(bytes, envelopeStart, bodyBytes) {
  if (bytes.length !== slotBytes) throw frameCorrupt();
  const table = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = table.getUint32(0);
  const length = table.getUint32(slotIntegerBytes);
  const digest = bytesToHex(bytes.subarray(2 * slotIntegerBytes));
  if (offset <= envelopeStart || length < 2 || offset + length > bodyBytes) throw frameCorrupt();
  return { offset, length, digest };
}

export function decodePartitionCollectionFrameSlot({
  bytes,
  request,
  layout,
  slot,
  position: { offset, length, digest },
}) {
  try {
    if (bytes.length !== length || slotDigest(request, layout, { slot, offset, bytes }) !== digest)
      throw frameCorrupt();
    return decodeCollectionMutation(decodeSlotText(bytes), request.epoch);
  } catch (cause) {
    if (cause.code === "SESSION_STORAGE_CORRUPT") throw cause;
    throw Object.assign(frameCorrupt(), { cause });
  }
}

export function decodePartitionJournalFrameRequest(body, publication) {
  if (publication === "journal")
    return requirePartitionJournalRequest(JSON.parse(decodeUtf8.decode(body)));
  if (publication !== "collections") throw new TypeError("Unknown journal publication protocol");
  const layout = partitionCollectionFrameBodyStart(body.subarray(0, slotIntegerBytes), body.length);
  const { count, envelopeStart } = layout;
  const positions = [];
  for (let slot = 0; slot < count; slot++) {
    const start = partitionCollectionSlotOffset(slot);
    positions.push(
      requirePartitionCollectionFrameSlot(
        body.subarray(start, start + slotBytes),
        envelopeStart,
        body.length,
      ),
    );
  }
  const envelopeEnd = count ? positions[0].offset : body.length;
  const request = decodeCollectionEnvelope(body.subarray(envelopeStart, envelopeEnd));
  const mutations = positions.map((position, slot) => {
    const end = position.offset + position.length;
    if (end !== (slot + 1 === count ? body.length : positions[slot + 1].offset))
      throw frameCorrupt();
    return decodePartitionCollectionFrameSlot({
      bytes: body.subarray(position.offset, end),
      request,
      layout,
      slot,
      position,
    });
  });
  return { ...request, payload: { ...request.payload, mutations } };
}

export async function partitionJournalAdmission(head, request, lookupReceipt, matches) {
  requirePartitionRequestPosition(request);
  if (request.epoch !== head.epoch)
    throw new PartitionAdmissionRejection(
      "SESSION_REQUEST_EPOCH",
      "Request belongs to another writer epoch",
    );
  if (request.sequence <= head.sequence) {
    const receipt = await lookupReceipt(request.sequence);
    if (!receipt)
      throw new PartitionAdmissionRejection(
        "SESSION_REQUEST_EXPIRED",
        "Request is outside the retry window",
      );
    if (!matches(receipt))
      throw new PartitionAdmissionRejection(
        "SESSION_OPERATION_CONFLICT",
        "Request sequence has different content",
      );
    return receipt;
  }
  if (request.sequence !== head.sequence + 1)
    throw new PartitionAdmissionRejection(
      "SESSION_GENERATION_CONFLICT",
      "Request sequence is not contiguous",
    );
  return null;
}

export function extendPartitionEntityProjection(head, cursor, mutationCount) {
  if (mutationCount) {
    const pending = head.deferredEntityUpdates;
    head.deferredEntityUpdates = {
      start: pending === null ? { ...cursor } : pending.start,
      mutationCount: (pending === null ? 0 : pending.mutationCount) + mutationCount,
    };
  }
}

export function createPartitionJournalHead({ sessionId, epoch, limits, publication }) {
  const head = requirePartitionJournalHead({
    ...emptyJournalState(limits),
    format: PARTITION_JOURNAL_FORMAT,
    sessionId,
    epoch,
    publication,
  });
  head.limits = Object.freeze({ ...limits });
  return head;
}

function requireDeferredUpdateBoundary(head) {
  if (head.deferredEntityUpdates === null) return;
  const start = requirePartitionJournalCursor(head.deferredEntityUpdates.start);
  if (
    head.publication !== "collections" ||
    !partitionEntityProjectionFits(start, head) ||
    start.sequence < head.sequence - head.partitionRecords ||
    start.sequence >= head.sequence ||
    start.offset >= head.tail.offset ||
    head.deferredEntityUpdates.mutationCount > head.tail.offset - start.offset
  )
    throw new TypeError("Invalid deferred entity update boundary");
}

export function requirePartitionJournalHead(head) {
  exactObject(
    head,
    [
      "format",
      "sessionId",
      "epoch",
      "sequence",
      "tail",
      "partitionRecords",
      "dataBytes",
      "receiptStart",
      "limits",
      "publication",
      "entityDirectory",
      "deferredEntityUpdates",
    ],
    "partition journal head",
  );
  if (
    head.format !== PARTITION_JOURNAL_FORMAT ||
    typeof head.sessionId !== "string" ||
    !head.sessionId
  )
    throw new TypeError("Invalid partition journal identity");
  requirePartitionJournalRequest({ epoch: head.epoch, sequence: head.sequence + 1, payload: null });
  partitionJournalPublicationParticipants(head.publication);
  requirePartitionJournalCursor(head.tail);
  requirePartitionJournalCursor(head.receiptStart);
  const limits = requirePartitionJournalLimits(head.limits);
  requireEntityDirectoryHead(head.entityDirectory, limits);
  if (head.publication === "collections") requireCollectionPageCapacity(limits);
  if (head.deferredEntityUpdates !== null) {
    exactObject(head.deferredEntityUpdates, ["start", "mutationCount"], "deferred entity updates");
    positive(head.deferredEntityUpdates.mutationCount, "deferred update mutation count");
  }
  if (
    !Number.isSafeInteger(head.sequence) ||
    head.sequence < 0 ||
    head.sequence !== head.tail.sequence ||
    !Number.isSafeInteger(head.partitionRecords) ||
    head.partitionRecords < 0 ||
    head.partitionRecords > limits.partitionRecords ||
    head.tail.offset > limits.partitionBytes ||
    !Number.isSafeInteger(head.dataBytes) ||
    head.dataBytes < head.tail.offset ||
    !partitionJournalHasCapacity(head)
  )
    throw new TypeError("Invalid partition journal publication boundary");
  requireDeferredUpdateBoundary(head);
  requirePublicationExtent(head, limits);
  requireReceiptBoundary(head, limits);
  return head;
}

function requirePublicationExtent(head, limits) {
  const { sequence, tail, partitionRecords, dataBytes } = head;
  const minimumFrame = PARTITION_JOURNAL_FRAME.headerBytes + PARTITION_JOURNAL_FRAME.trailer.length;
  if (
    (sequence === 0 &&
      (tail.partition !== 0 || tail.offset !== 0 || partitionRecords !== 0 || dataBytes !== 0)) ||
    (sequence > 0 && (partitionRecords === 0 || tail.offset === 0)) ||
    partitionRecords > sequence ||
    sequence - partitionRecords < tail.partition ||
    (sequence - partitionRecords) / limits.partitionRecords > tail.partition ||
    tail.offset < partitionRecords * minimumFrame ||
    tail.offset > partitionRecords * limits.transactionBytes ||
    dataBytes - tail.offset < (sequence - partitionRecords) * minimumFrame ||
    (dataBytes - tail.offset) / limits.partitionBytes > tail.partition ||
    dataBytes / limits.transactionBytes > sequence
  )
    throw new TypeError("Invalid partition journal publication extent");
}

function requireReceiptBoundary(head, limits) {
  if (
    head.receiptStart.sequence > head.sequence ||
    (head.sequence > 0 && head.receiptStart.sequence === head.sequence) ||
    head.sequence - head.receiptStart.sequence > limits.receiptRecords ||
    head.receiptStart.partition > head.tail.partition ||
    (head.sequence > 0 &&
      head.tail.partition - head.receiptStart.partition >=
        head.sequence - head.receiptStart.sequence) ||
    head.receiptStart.offset >= limits.partitionBytes ||
    head.receiptStart.partition > head.receiptStart.sequence ||
    (head.receiptStart.sequence === 0 && head.receiptStart.offset !== 0) ||
    (head.receiptStart.partition === 0 &&
      head.receiptStart.sequence > 0 &&
      head.receiptStart.offset === 0) ||
    (head.receiptStart.partition === head.tail.partition &&
      (head.receiptStart.offset > head.tail.offset ||
        head.tail.offset - head.receiptStart.offset > limits.receiptBytes ||
        head.receiptStart.sequence < head.sequence - head.partitionRecords))
  )
    throw new TypeError("Invalid partition journal publication boundary");
}

const capturedSnapshots = new WeakSet();

export function assertCurrentPartitionJournalPublication(head, snapshot) {
  requireCapturedPartitionJournalSnapshot(snapshot);
  if (!isDeepStrictEqual(head, snapshot))
    throw partitionJournalError(
      "SESSION_MIGRATION_TARGET_CHANGED",
      "Staged journal changed during verification",
    );
}

export function capturePartitionJournalSnapshot(head) {
  const serialized = encodeBoundedJournalJson(head, {
    budget: PARTITION_JOURNAL_FRAME.controlBytes,
    maxDepth: PARTITION_JOURNAL_FRAME.maxJsonDepth,
    budgetError: () =>
      partitionJournalError("SESSION_SNAPSHOT_BUDGET", "Snapshot exceeds its reserved size"),
  });
  const snapshot = requirePartitionJournalHead(parseFrozenJournalJson(serialized));
  capturedSnapshots.add(snapshot);
  return snapshot;
}

export function requireCapturedPartitionJournalSnapshot(snapshot) {
  if (!capturedSnapshots.has(snapshot))
    throw partitionJournalError("SESSION_SNAPSHOT_RELEASED", "Snapshot was not captured");
  return snapshot;
}

export function requirePartitionSnapshotRecord(record, head, slot) {
  exactObject(record, ["format", "token", "slot", "head"], "partition snapshot");
  requirePartitionJournalHead(record.head);
  if (
    record.format !== PARTITION_SNAPSHOT_FORMAT ||
    typeof record.token !== "string" ||
    !/^[a-f0-9]{32}$/.test(record.token) ||
    !Number.isSafeInteger(record.slot) ||
    record.slot < 0 ||
    record.slot >= head.limits.retentionRecords ||
    record.slot !== slot ||
    record.head.sessionId !== head.sessionId ||
    record.head.epoch !== head.epoch ||
    record.head.sequence > head.sequence ||
    record.head.publication !== head.publication ||
    JSON.stringify(record.head.limits) !== JSON.stringify(head.limits)
  )
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid snapshot retention record");
  return record;
}
