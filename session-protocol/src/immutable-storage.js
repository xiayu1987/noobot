/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { storageDigest } from "#storage-digest";
import { immutableStorageError } from "./immutable-storage-error.js";
export { immutableStorageError } from "./immutable-storage-error.js";
export {
  IMMUTABLE_SESSION_COLLECTIONS,
  requireImmutableCollection,
} from "./immutable-collections.js";
import {
  IMMUTABLE_SEGMENT,
  immutableSegmentFileId,
  requireImmutableRecordReference,
  requireImmutableContentDigest,
  decodeImmutableRecordReference,
  encodeImmutableRecordReference,
  requireImmutableSegmentTail,
} from "./immutable-segment.js";
import { isFunction, isPlainObject, stableValue } from "@noobot/shared/value";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { isTerminalTurnState } from "./lifecycle/turn-state.js";
import { isUnsuccessfulTurnTerminalStatus } from "./lifecycle/turn-terminal.js";
import {
  IMMUTABLE_LOCATED_SESSION_FORMAT,
  isImmutableLocatedSessionFormat,
  requireImmutableLocatedSnapshot,
} from "./immutable-record-location.js";
export { IMMUTABLE_LOCATED_SESSION_FORMAT } from "./immutable-record-location.js";

export function immutableLifecyclePosition(turn) {
  if (
    !Number.isSafeInteger(turn?.sequence) ||
    turn.sequence < 1 ||
    typeof turn.turnScopeId !== "string" ||
    !turn.turnScopeId
  )
    throw immutableStorageError("Invalid lifecycle index identity");
  return (
    turn.sequence.toString(2).padStart(53, "0") +
    [...storageDigest(turn.turnScopeId)]
      .map((digit) => Number.parseInt(digit, 16).toString(2).padStart(4, "0"))
      .join("")
  );
}

export function isImmutableTerminalCandidate(turn, hasMessages) {
  return Boolean(
    turn &&
    isTerminalTurnState(turn.state) &&
    (hasMessages ||
      isUnsuccessfulTurnTerminalStatus(
        String(turn.terminalStatus?.status || turn.executionState || "")
          .trim()
          .toLowerCase(),
      )),
  );
}

export const IMMUTABLE_SESSION_FORMAT = "noobot.immutable-session/1";
export const IMMUTABLE_SEALED_SEGMENT_SESSION_FORMAT = "noobot.immutable-session/2";
export const IMMUTABLE_SEGMENT_SESSION_FORMAT = "noobot.immutable-session/3";
export const IMMUTABLE_CURRENT_SESSION_FORMAT = IMMUTABLE_LOCATED_SESSION_FORMAT;

export function immutableSessionReferenceContract(format) {
  if (format === IMMUTABLE_SESSION_FORMAT || isImmutableLocatedSessionFormat(format))
    return requireObjectReference;
  if (
    format === IMMUTABLE_SEGMENT_SESSION_FORMAT ||
    format === IMMUTABLE_SEALED_SEGMENT_SESSION_FORMAT
  )
    return requireImmutableRecordReference;
  throw immutableStorageError("Unknown immutable session storage format");
}

export function immutableReplayReference(format, digest, length) {
  immutableSessionReferenceContract(format);
  requireObjectReference(digest);
  if (format === IMMUTABLE_SESSION_FORMAT || isImmutableLocatedSessionFormat(format)) return digest;
  return encodeImmutableRecordReference({
    segmentId: digest.slice(0, 32),
    offset: IMMUTABLE_SEGMENT.magic.length,
    length,
    digest,
  });
}

export function immutableSessionPhysicalHeadFields(head) {
  immutableSessionReferenceContract(head.format);
  if (isImmutableLocatedSessionFormat(head.format))
    return { segmentTail: head.segmentTail, locationRoot: head.locationRoot };
  if (head.format === IMMUTABLE_SEGMENT_SESSION_FORMAT) return { segmentTail: head.segmentTail };
  return {};
}

export function requireImmutableStoredContent(reference, { digest, length }, format) {
  immutableSessionReferenceContract(format)(reference);
  const identity =
    format === IMMUTABLE_SESSION_FORMAT || isImmutableLocatedSessionFormat(format)
      ? { digest: reference, length }
      : decodeImmutableRecordReference(reference);
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > LENGTH_THRESHOLDS.immutableStorage.blockBytes ||
    length !== identity.length ||
    digest !== identity.digest
  )
    throw immutableStorageError("Immutable bytes do not match their committed identity");
  return reference;
}
export const IMMUTABLE_SESSION_HEAD_FILE = "head.json";
export const IMMUTABLE_SESSION_FORMAT_FILE = "immutable-session.format";
const PUBLICATION_TOKEN = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const PUBLICATION_TOKEN_PATTERN = new RegExp(`^${PUBLICATION_TOKEN}$`);
const PUBLICATION_TEMPORARY = new RegExp(`^([\\s\\S]+)\\.(${PUBLICATION_TOKEN})\\.tmp$`);

export function immutablePublicationTemporaryFile(target, token) {
  if (
    typeof target !== "string" ||
    !target ||
    typeof token !== "string" ||
    !PUBLICATION_TOKEN_PATTERN.test(token)
  )
    throw new TypeError("Immutable publication requires a target and canonical UUID token");
  return `${target}.${token}.tmp`;
}

export function immutablePublicationTarget(file) {
  if (typeof file !== "string") return null;
  return PUBLICATION_TEMPORARY.exec(file)?.[1] ?? null;
}

export const IMMUTABLE_MAINTENANCE_BUDGET = Object.freeze({
  maxRemovals: 256,
  maxCandidates: 256,
  maxObjectReads: 100000,
});

export function requireImmutableMaintenanceLimit(name, value) {
  if (!Object.hasOwn(IMMUTABLE_MAINTENANCE_BUDGET, name))
    throw new TypeError("Unknown immutable maintenance limit");
  const maximum = name === "maxRemovals" ? 4096 : 1000000;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new TypeError(`Immutable maintenance ${name} must be an integer in 1..${maximum}`);
  return value;
}

export const IMMUTABLE_SESSION_DIRECTORIES = Object.freeze({
  objects: "objects",
  staging: "staging",
});

export const IMMUTABLE_READER_RETENTION = Object.freeze({
  format: "noobot.immutable-reader/1",
  directory: "staging/readers",
  recordBytes: LENGTH_THRESHOLDS.immutableStorage.readerRetentionRecordBytes,
});

export function requireImmutableReaderRecoveryRequest(phase, request) {
  if (!["inspect", "recover"].includes(phase) || !isPlainObject(request))
    throw new TypeError("Invalid immutable reader recovery request");
  const fields = ["storageService", "sessionDir", "sessionId", "readerId", "signal", "format"];
  if (phase === "recover")
    fields.push("assertSessionWritable", "assertReadersStopped", "expectedRecordDigest");
  if (Object.keys(request).some((key) => !fields.includes(key)))
    throw new TypeError("Unknown immutable reader recovery field");
  immutableSessionReferenceContract(request.format);
  requireImmutableCleanupPlanId(request.readerId);
  if (phase === "recover") {
    requireObjectReference(request.expectedRecordDigest);
    if (!isFunction(request.assertReadersStopped))
      throw new TypeError("Reader recovery requires an explicit quiescence assertion");
  }
  return request;
}

export function requireImmutableReaderRetention(record, id, format = IMMUTABLE_SESSION_FORMAT) {
  if (
    !isPlainObject(record) ||
    Object.keys(record).length !== 3 ||
    record.format !== IMMUTABLE_READER_RETENTION.format ||
    record.id !== requireImmutableCleanupPlanId(id)
  )
    throw immutableStorageError("Invalid immutable reader retention record");
  requireImmutableSessionHead(record.head, undefined, format);
  return record;
}

export function encodeImmutableReaderRetention(record, id, format = IMMUTABLE_SESSION_FORMAT) {
  const raw = encodeImmutableCleanupRecord(requireImmutableReaderRetention(record, id, format));
  if (new TextEncoder().encode(raw).length > IMMUTABLE_READER_RETENTION.recordBytes)
    throw immutableStorageError("Reader retention record exceeds protocol limit");
  return raw;
}

export function decodeImmutableReaderRetentionBytes(bytes, id, format = IMMUTABLE_SESSION_FORMAT) {
  if (!ArrayBuffer.isView(bytes) || bytes.byteLength > IMMUTABLE_READER_RETENTION.recordBytes)
    throw immutableStorageError("Invalid or oversized reader retention bytes");
  return requireImmutableReaderRetention(decodeImmutableCleanupBytes(bytes), id, format);
}

export function requireImmutableRetainedSnapshot(snapshot, head) {
  requireImmutableSessionHead(head, undefined, head.format);
  requireImmutableSessionHead(snapshot, undefined, head.format);
  if (snapshot.sessionId !== head.sessionId || snapshot.generation > head.generation)
    throw immutableStorageError("Retained reader does not belong to the committed history");
  return snapshot;
}

export function createImmutableReaderLifecycle({ generation, methods, release }) {
  if (!Number.isSafeInteger(generation) || generation < 1 || !isFunction(release))
    throw new TypeError("Immutable reader requires a generation and release operation");
  let closing = false;
  let closePromise;
  let active = 0;
  let drained;
  const close = () => {
    closing = true;
    if (!closePromise)
      closePromise = (async () => {
        if (active)
          await new Promise((resolve) => {
            drained = resolve;
          });
        await release();
      })().catch((error) => {
        closePromise = undefined;
        throw error;
      });
    return closePromise;
  };
  const reader = { generation, close, [Symbol.asyncDispose]: close };
  for (const [name, method] of Object.entries(methods)) {
    if (!isFunction(method) || Object.hasOwn(reader, name))
      throw new TypeError("Invalid immutable reader operation");
    reader[name] = async (...args) => {
      if (closing)
        throw Object.assign(new Error("Immutable session reader is closed"), {
          code: "SESSION_READER_CLOSED",
        });
      active += 1;
      try {
        return await method(...args);
      } finally {
        active -= 1;
        if (!active) drained?.();
      }
    };
  }
  return Object.freeze(reader);
}

export const IMMUTABLE_CLEANUP_PLAN = Object.freeze({
  format: "noobot.immutable-cleanup/3",
  sessionFormat: IMMUTABLE_LOCATED_SESSION_FORMAT,
  directory: "staging/maintenance",
  manifest: "plan.json",
  progress: "progress.json",
  preparation: "preparation.json",
  preparationFormat: "noobot.cleanup-preparation/1",
  capture: "capture.json",
  captureFormat: "noobot.cleanup-capture/2",
  retentionDirectory: "retention",
  retentionSegments: 64,
  retentionState: "retention.json",
  retentionFormat: "noobot.cleanup-retention/2",
  markingPages: 32,
  maxMarkingPages: 128,
  chunkEntries: 64,
  chunkPages: 4096,
  recordBytes: LENGTH_THRESHOLDS.immutableStorage.cleanupRecordBytes,
});

export function requireImmutableCleanupPreparation(record, id) {
  if (
    !isPlainObject(record) ||
    Object.keys(record).length !== 3 ||
    record.format !== IMMUTABLE_CLEANUP_PLAN.preparationFormat ||
    record.id !== requireImmutableCleanupPlanId(id) ||
    !Array.isArray(record.heads) ||
    record.heads.length === 0
  )
    throw immutableStorageError("Invalid cleanup preparation ownership");
  const snapshots = new Set();
  for (const head of record.heads) {
    requireImmutableSessionHead(
      head,
      record.heads[0].sessionId,
      requireImmutableCleanupSessionFormat(head?.format),
    );
    const encoded = encodeImmutableSessionHead(head, head.format);
    if (snapshots.has(encoded))
      throw immutableStorageError("Duplicate cleanup preparation snapshot");
    snapshots.add(encoded);
  }
  return record;
}

export function immutableCleanupPreparationInterrupted(planId, cause) {
  return Object.assign(
    new Error("Cleanup preparation interrupted; resume or discard the plan", { cause }),
    {
      code: "SESSION_MAINTENANCE_PREPARATION_INTERRUPTED",
      planId: requireImmutableCleanupPlanId(planId),
    },
  );
}

export function requireImmutableCleanupCapture(record, id) {
  const plan = IMMUTABLE_CLEANUP_PLAN;
  if (
    !isPlainObject(record) ||
    Object.keys(record).length !== 7 ||
    record.format !== plan.captureFormat ||
    record.id !== requireImmutableCleanupPlanId(id) ||
    typeof record.dryRun !== "boolean" ||
    typeof record.ready !== "boolean" ||
    !Number.isSafeInteger(record.candidates) ||
    record.candidates < 0 ||
    !Number.isSafeInteger(record.pages) ||
    record.pages !== Math.ceil(record.candidates / plan.chunkEntries) ||
    record.pages > plan.chunkPages ||
    (record.firstChunk === null) !== (record.candidates === 0)
  )
    throw immutableStorageError("Invalid cleanup inventory capture");
  if (record.firstChunk !== null) requireImmutableContentDigest(record.firstChunk);
  return record;
}

export function requireImmutableCleanupMark(mark) {
  if (mark === null) return mark;
  if (
    !isPlainObject(mark) ||
    Object.keys(mark).length !== 3 ||
    !Number.isSafeInteger(mark.rootIndex) ||
    mark.rootIndex < 0 ||
    typeof mark.path !== "string" ||
    !/^[a-f0-9]{0,64}$/.test(mark.path)
  )
    throw immutableStorageError("Invalid cleanup marking cursor");
  requireImmutableContentDigest(mark.headsDigest);
  return mark;
}

export function requireImmutableCleanupMarkingBudget(maxPages) {
  if (
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > IMMUTABLE_CLEANUP_PLAN.maxMarkingPages
  )
    throw new TypeError("Cleanup marking requires a bounded maxPages");
  return maxPages;
}

export function requireImmutableCleanupRetention(state) {
  if (
    !isPlainObject(state) ||
    Object.keys(state).length !== 5 ||
    state.format !== IMMUTABLE_CLEANUP_PLAN.retentionFormat ||
    !Number.isSafeInteger(state.size) ||
    state.size < 0 ||
    (state.root === null) !== (state.size === 0) ||
    (state.segmentTail === null) !== (state.root === null)
  )
    throw immutableStorageError("Invalid cleanup retention checkpoint");
  if (state.root !== null) requireImmutableRecordReference(state.root);
  requireImmutableSegmentTail(state.segmentTail);
  requireImmutableCleanupMark(state.mark);
  return state;
}

export function requireImmutableCleanupSessionFormat(format) {
  if (format !== IMMUTABLE_CLEANUP_PLAN.sessionFormat)
    throw Object.assign(
      immutableStorageError("Cleanup requires a session migrated to the current storage format"),
      { code: "SESSION_MAINTENANCE_MIGRATION_REQUIRED" },
    );
  return format;
}

export async function requireImmutableCleanupHead(head, current, readCommit) {
  requireImmutableSessionHead(head, undefined, requireImmutableCleanupSessionFormat(head?.format));
  requireImmutableSessionHead(current, head.sessionId, head.format);
  if (
    encodeImmutableSessionHead(head, head.format) ===
    encodeImmutableSessionHead(current, head.format)
  )
    return;

  if (
    head.generation > 0 &&
    current.generation > head.generation &&
    current.commit !== head.commit &&
    isFunction(readCommit) &&
    (await readCommit(head.generation)) === head.commit
  )
    return;
  throw Object.assign(
    new Error("Cleanup snapshot is not an ancestor of the current storage history"),
    {
      code: "SESSION_MAINTENANCE_PLAN_STALE",
    },
  );
}

export function requireImmutableCleanupFilterBudget(maxEntries) {
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > QUANTITY_THRESHOLDS.immutableStorage.cleanupFilterMaxEntries
  )
    throw new TypeError("Cleanup filtering requires a bounded maxFilterEntries");
  return maxEntries;
}

const CLEANUP_REQUEST_FIELDS = Object.freeze({
  prepare: ["dryRun", "planId", "maxMarkingPages", "maxFilterEntries"],
  apply: ["planId", "maxRemovals", "maxCandidates"],
  discard: ["planId"],
});
const CLEANUP_CONTEXT_FIELDS = [
  "storageService",
  "sessionDir",
  "sessionId",
  "assertSessionWritable",
  "signal",
];

export function requireImmutableCleanupRequest(phase, options) {
  if (!Object.hasOwn(CLEANUP_REQUEST_FIELDS, phase) || !isPlainObject(options))
    throw new TypeError("Invalid immutable cleanup request");
  const allowed = new Set([...CLEANUP_CONTEXT_FIELDS, ...CLEANUP_REQUEST_FIELDS[phase]]);
  for (const field of Object.keys(options))
    if (!allowed.has(field))
      throw new TypeError(`Unknown immutable cleanup ${phase} field: ${field}`);
  if (phase === "prepare") {
    if (typeof options.dryRun !== "boolean")
      throw new TypeError("Cleanup preparation requires dryRun");
    if (options.planId !== undefined) {
      requireImmutableCleanupPlanId(options.planId);
    }
    if (options.maxMarkingPages !== undefined)
      requireImmutableCleanupMarkingBudget(options.maxMarkingPages);
    if (options.maxFilterEntries !== undefined)
      requireImmutableCleanupFilterBudget(options.maxFilterEntries);
  } else requireImmutableCleanupPlanId(options.planId);
  return options;
}

export function requireImmutableCleanupPlanId(id) {
  if (typeof id !== "string" || !PUBLICATION_TOKEN_PATTERN.test(id))
    throw new TypeError("Immutable cleanup requires a canonical plan UUID");
  return id;
}

export function requireImmutableCleanupCandidate(file, format) {
  requireImmutableCleanupSessionFormat(format);
  if (typeof file !== "string") throw immutableStorageError("Invalid cleanup candidate");
  const parts = file.split("/");
  if (parts.length === 1) {
    const target = immutablePublicationTarget(file);
    if (target === IMMUTABLE_SESSION_HEAD_FILE || target === IMMUTABLE_SESSION_FORMAT_FILE)
      return file;
  }
  if (
    parts.length === 2 &&
    parts[0] === IMMUTABLE_SEGMENT.directory &&
    immutableSegmentFileId(immutablePublicationTarget(parts[1]) ?? parts[1]) !== null
  )
    return file;
  throw immutableStorageError("Invalid cleanup candidate path");
}

export function encodeImmutableCleanupRecord(record) {
  const payload = JSON.stringify(record);
  const raw = JSON.stringify({ payload, checksum: storageDigest(payload) });
  if (new TextEncoder().encode(raw).length > IMMUTABLE_CLEANUP_PLAN.recordBytes)
    throw immutableStorageError("Oversized cleanup record");
  return raw;
}

export function decodeImmutableCleanupBytes(bytes) {
  try {
    if (!ArrayBuffer.isView(bytes) || bytes.byteLength > IMMUTABLE_CLEANUP_PLAN.recordBytes)
      throw immutableStorageError("Invalid cleanup record bytes");
    return decodeImmutableCleanupRecord(IMMUTABLE_JSON_DECODER.decode(bytes));
  } catch (cause) {
    throw immutableStorageError("Invalid immutable cleanup bytes", cause);
  }
}

export function decodeImmutableCleanupRecord(raw) {
  try {
    if (
      typeof raw !== "string" ||
      new TextEncoder().encode(raw).length > IMMUTABLE_CLEANUP_PLAN.recordBytes
    )
      throw immutableStorageError("Oversized cleanup record");
    const envelope = JSON.parse(raw);
    if (
      !isPlainObject(envelope) ||
      Object.keys(envelope).length !== 2 ||
      typeof envelope.payload !== "string" ||
      storageDigest(envelope.payload) !== envelope.checksum
    )
      throw immutableStorageError("Invalid cleanup record checksum");
    const record = JSON.parse(envelope.payload);
    if (!isPlainObject(record)) throw immutableStorageError("Invalid cleanup record");
    return record;
  } catch (cause) {
    throw immutableStorageError("Invalid immutable cleanup record", cause);
  }
}
export function requireImmutableCleanupManifest(plan, id) {
  if (
    !isPlainObject(plan) ||
    Object.keys(plan).length !== 7 ||
    plan.format !== IMMUTABLE_CLEANUP_PLAN.format ||
    plan.id !== requireImmutableCleanupPlanId(id) ||
    typeof plan.dryRun !== "boolean" ||
    !Number.isSafeInteger(plan.candidates) ||
    plan.candidates < 0 ||
    !Number.isSafeInteger(plan.retainedSegments) ||
    plan.retainedSegments < 0
  )
    throw immutableStorageError("Invalid cleanup manifest");
  requireImmutableSessionHead(
    plan.head,
    undefined,
    requireImmutableCleanupSessionFormat(plan.head?.format),
  );
  if (plan.firstChunk !== null) requireObjectReference(plan.firstChunk);
  if ((plan.firstChunk === null) !== (plan.candidates === 0))
    throw immutableStorageError("Invalid cleanup candidate chain");
  return plan;
}

export function requireImmutableCleanupProgress(progress, digest, plan) {
  if (
    !isPlainObject(progress) ||
    Object.keys(progress).length !== 4 ||
    progress.plan !== digest ||
    !Number.isSafeInteger(progress.offset) ||
    progress.offset < 0 ||
    progress.offset >= IMMUTABLE_CLEANUP_PLAN.chunkEntries ||
    !Number.isSafeInteger(progress.processed) ||
    progress.processed < 0 ||
    progress.processed > plan.candidates
  )
    throw immutableStorageError("Invalid cleanup progress");
  if (progress.chunk !== null) requireObjectReference(progress.chunk);
  if (progress.chunk === null && (progress.offset !== 0 || progress.processed !== plan.candidates))
    throw immutableStorageError("Incomplete cleanup progress");
  if (progress.chunk !== null) requireCleanupPagePosition(progress, plan);
  return progress;
}

function requireCleanupPagePosition(progress, plan) {
  const consumed = progress.processed - progress.offset;
  const firstPageSize = ((plan.candidates - 1) % IMMUTABLE_CLEANUP_PLAN.chunkEntries) + 1;
  if (
    progress.processed >= plan.candidates ||
    consumed < 0 ||
    (consumed === 0 && (progress.chunk !== plan.firstChunk || progress.offset >= firstPageSize)) ||
    (consumed !== 0 &&
      (progress.chunk === plan.firstChunk ||
        consumed < firstPageSize ||
        (consumed - firstPageSize) % IMMUTABLE_CLEANUP_PLAN.chunkEntries !== 0))
  )
    throw immutableStorageError("Cleanup cursor disagrees with its candidate chain");
}

export function requireImmutableCleanupCursorChunk(chunk, progress, plan) {
  requireImmutableCleanupChunk(chunk, plan.head.format);
  const consumed = progress.processed - progress.offset;
  const expected =
    consumed === 0
      ? ((plan.candidates - 1) % IMMUTABLE_CLEANUP_PLAN.chunkEntries) + 1
      : IMMUTABLE_CLEANUP_PLAN.chunkEntries;
  const remaining = plan.candidates - consumed;
  if (chunk.files.length !== expected || (chunk.previous === null) !== (remaining === expected))
    throw immutableStorageError("Cleanup page disagrees with its candidate count");
  return chunk;
}

export function requireImmutableCleanupChunk(chunk, format) {
  immutableSessionReferenceContract(format);
  if (
    !isPlainObject(chunk) ||
    Object.keys(chunk).length !== 2 ||
    !Array.isArray(chunk.files) ||
    !chunk.files.length ||
    chunk.files.length > IMMUTABLE_CLEANUP_PLAN.chunkEntries
  )
    throw immutableStorageError("Invalid cleanup chunk");
  if (chunk.previous !== null) requireObjectReference(chunk.previous);
  for (const file of chunk.files) requireImmutableCleanupCandidate(file, format);
  if (new Set(chunk.files).size !== chunk.files.length)
    throw immutableStorageError("Duplicate cleanup candidate");
  return chunk;
}

export const IMMUTABLE_CHECKPOINT_FORBIDDEN_WORK = Object.freeze([
  "optionalJsonReads",
  "checkpointIdentityCollections",
  "checkpointIdentityVisits",
  "materializedMessages",
  "projectionRebuiltMessages",
  "projectionSizeMessages",
  "foldedRecords",
  "journalReadBytes",
  "eventJournalReadBytes",
  "pruneDirectoryScans",
  "pruneSnapshotVisits",
]);
const HEAD_FIELDS = ["format", "sessionId", "generation", "root", "operations", "commit"];
const REFERENCE_PATTERN = /^[a-f0-9]{64}$/;

const IMMUTABLE_JSON_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function decodeImmutableJsonBytes(bytes, reference) {
  try {
    return JSON.parse(IMMUTABLE_JSON_DECODER.decode(bytes));
  } catch (cause) {
    throw immutableStorageError(`Invalid immutable JSON: ${reference}`, cause);
  }
}

export function requireObjectReference(reference) {
  if (typeof reference !== "string" || !REFERENCE_PATTERN.test(reference))
    throw immutableStorageError("Invalid immutable object reference");
  return reference;
}

export function requireImmutableSessionHead(head, sessionId, format = IMMUTABLE_SESSION_FORMAT) {
  const requireReference = immutableSessionReferenceContract(format);
  const fields = isImmutableLocatedSessionFormat(format)
    ? [...HEAD_FIELDS, "segmentTail", "locationRoot"]
    : format === IMMUTABLE_SEGMENT_SESSION_FORMAT
      ? [...HEAD_FIELDS, "segmentTail"]
      : HEAD_FIELDS;
  if (
    !isPlainObject(head) ||
    Object.keys(head).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(head, field)) ||
    head.format !== format ||
    typeof head.sessionId !== "string" ||
    !head.sessionId ||
    (sessionId !== undefined && head.sessionId !== sessionId) ||
    !Number.isSafeInteger(head.generation) ||
    head.generation < 1
  )
    throw immutableStorageError("Invalid immutable session head");
  if (head.root !== null) requireReference(head.root);
  requireReference(head.operations);
  requireReference(head.commit);
  if (format === IMMUTABLE_SEGMENT_SESSION_FORMAT) requireImmutableSegmentTail(head.segmentTail);
  if (isImmutableLocatedSessionFormat(format)) requireImmutableLocatedSnapshot(head);
  return head;
}

function requireHeadText(raw) {
  if (
    typeof raw !== "string" ||
    new TextEncoder().encode(raw).length > LENGTH_THRESHOLDS.immutableStorage.headBytes
  )
    throw immutableStorageError("Invalid or oversized immutable session head");
  return raw;
}

export function encodeImmutableSessionHead(head, format = IMMUTABLE_SESSION_FORMAT) {
  requireImmutableSessionHead(head, undefined, format);

  const payload = JSON.stringify(stableValue(head));
  return requireHeadText(JSON.stringify({ payload, checksum: storageDigest(payload) }));
}

export function decodeImmutableSessionHeadBytes(bytes, sessionId, format) {
  try {
    if (
      !ArrayBuffer.isView(bytes) ||
      bytes.byteLength > LENGTH_THRESHOLDS.immutableStorage.headBytes
    )
      throw immutableStorageError("Invalid or oversized immutable session head bytes");
    return decodeImmutableSessionHead(IMMUTABLE_JSON_DECODER.decode(bytes), sessionId, format);
  } catch (cause) {
    throw immutableStorageError("Invalid immutable session head bytes", cause);
  }
}

export function decodeImmutableSessionHead(raw, sessionId, format) {
  try {
    const envelope = JSON.parse(requireHeadText(raw));
    if (
      !isPlainObject(envelope) ||
      Object.keys(envelope).length !== 2 ||
      typeof envelope.payload !== "string" ||
      storageDigest(envelope.payload) !== envelope.checksum
    )
      throw immutableStorageError("Invalid immutable session head envelope");
    const head = JSON.parse(envelope.payload);
    return requireImmutableSessionHead(head, sessionId, format ?? head?.format);
  } catch (cause) {
    if (cause.code === "SESSION_IMMUTABLE_STORAGE_INVALID") throw cause;
    throw immutableStorageError("Invalid immutable session head encoding", cause);
  }
}
