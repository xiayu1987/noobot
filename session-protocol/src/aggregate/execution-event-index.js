/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { isCanonicalDialogProcessKey, requireDialogProcessKey } from "../identity.js";
import { requireExecutionLogProjectionOutcomes } from "./execution-log-projection.js";
export * from "./execution-log-projection.js";
export { EXECUTION_LOG_APPEND_OUTCOME, executionLogAppendFailure } from "./execution-log-append.js";

export const EXECUTION_EVENT_INDEX_SCHEMA_VERSION = 3;

export const EXECUTION_EVENT_INDEX_FILE = "index.json";
export const EXECUTION_EVENT_TURNS_DIR = "turns";

export const EXECUTION_LOG_BATCH_MAX_RECORDS = 100;

export const EXECUTION_LOG_MAX_PENDING_RECORDS = 1000;

export function executionLogByteBudget() {
  const batchBytes = LENGTH_THRESHOLDS.artifact.executionLogBatchBytes;
  const pendingBytes = LENGTH_THRESHOLDS.artifact.executionLogPendingBytes;
  if (pendingBytes < batchBytes) {
    throw new RangeError("execution log pending byte budget must cover a complete batch");
  }
  return { batchBytes, pendingBytes };
}

function encodeBoundedExecutionLogRecord(record, maxBytes) {
  const dialogProcessId = requireDialogProcessKey(record?.dialogProcessId);
  const encoded = encodeExecutionSegmentRecord(record);
  if (encoded.bytes > maxBytes) {
    throw Object.assign(new RangeError("execution log record exceeds batch byte budget"), {
      code: "EXECUTION_LOG_RECORD_TOO_LARGE",
    });
  }

  const canonical = decodeExecutionSegmentRecord(
    encoded.line,
    "execution log admission",
    dialogProcessId,
  );
  return { ...encoded, record: canonical };
}

export function encodeExecutionLogBatch(records) {
  requireExecutionLogBatch(records);
  const { batchBytes } = executionLogByteBudget();
  let bytes = 0;
  return records.map((record) => {
    const encoded = encodeBoundedExecutionLogRecord(record, batchBytes);
    bytes += encoded.bytes;
    if (bytes > batchBytes) {
      throw Object.assign(new RangeError("execution log batch exceeds byte budget"), {
        code: "EXECUTION_LOG_BATCH_TOO_LARGE",
      });
    }
    return {
      dialogProcessId: encoded.record.dialogProcessId,
      line: encoded.line,
      bytes: encoded.bytes,
    };
  });
}

export function prepareExecutionLogRecord(record) {
  const encoded = encodeBoundedExecutionLogRecord(record, executionLogByteBudget().batchBytes);

  return { record: encoded.record, bytes: encoded.bytes };
}

export function* partitionExecutionLogRecords(records) {
  const { batchBytes } = executionLogByteBudget();
  let batch = [];
  let bytes = 0;
  for (const record of records) {
    const encoded = encodeExecutionSegmentRecord(record);
    if (encoded.bytes > batchBytes)
      throw Object.assign(new RangeError("execution log record exceeds batch byte budget"), {
        code: "EXECUTION_LOG_RECORD_TOO_LARGE",
      });
    if (batch.length === EXECUTION_LOG_BATCH_MAX_RECORDS || bytes + encoded.bytes > batchBytes) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(record);
    bytes += encoded.bytes;
  }
  if (batch.length) yield batch;
}

export function executionLogQueueWaitBudget() {
  return TIME_THRESHOLDS.agent.executionLogQueueWaitMs;
}

export function executionLogBatchWaitBudget() {
  const waitMs = TIME_THRESHOLDS.agent.executionLogBatchWaitMs;
  if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs >= executionLogQueueWaitBudget())
    throw new RangeError("execution log batch wait must fit within its queue wait budget");
  return waitMs;
}

export function executionLogQueueWaitFailure(waitMs, maxWaitMs) {
  if (!Number.isFinite(waitMs) || waitMs < 0 || !Number.isFinite(maxWaitMs) || maxWaitMs <= 0) {
    throw new RangeError(
      "execution log queue wait requires nonnegative time and a positive budget",
    );
  }
  if (waitMs <= maxWaitMs) return null;
  return Object.assign(new Error("execution log queue wait budget exceeded"), {
    code: "EXECUTION_LOG_QUEUE_WAIT_EXCEEDED",
    waitMs,
    maxWaitMs,
  });
}

class ExecutionLogProjectionError extends Error {
  constructor(cause, records, outcomes) {
    super("execution log committed but runtime projection failed", { cause });
    this.code = "EXECUTION_LOG_PROJECTION_FAILED";
    this.commitState = "committed";
    this.projection = { records, outcomes };
  }
}

export function executionLogProjectionFailure(cause, records, outcomes) {
  requireExecutionLogProjectionOutcomes(records, outcomes);

  if (cause instanceof ExecutionLogProjectionError) return cause;
  return new ExecutionLogProjectionError(cause, records, outcomes);
}

export function requireExecutionLogBatchSize(records) {
  if (
    !Array.isArray(records) ||
    records.length === 0 ||
    records.length > EXECUTION_LOG_BATCH_MAX_RECORDS
  ) {
    throw new TypeError(
      `execution log batch requires 1..${EXECUTION_LOG_BATCH_MAX_RECORDS} records`,
    );
  }
  return records;
}

export function requireExecutionLogBatch(records) {
  requireExecutionLogBatchSize(records);
  for (const record of records) {
    if (!isPlainObject(record)) throw new TypeError("execution log batch requires plain records");
    requireDialogProcessKey(record.dialogProcessId);
  }
  return records;
}

export const EXECUTION_EVENT_INDEX_ERROR_CODE = Object.freeze({
  CORRUPTED: "EXECUTION_EVENT_INDEX_CORRUPTED",
  SCHEMA_UNSUPPORTED: "EXECUTION_EVENT_INDEX_SCHEMA_UNSUPPORTED",
  TURN_UNREGISTERED: "EXECUTION_TURN_UNREGISTERED",
  SEGMENT_UNINDEXED: "EXECUTION_SEGMENT_UNINDEXED",
});

export const EXECUTION_EVENT_SEGMENT_ERROR_CODE = Object.freeze({
  MISSING: "EXECUTION_EVENT_SEGMENT_MISSING",
  JSONL_CORRUPTED: "EXECUTION_EVENT_JSONL_CORRUPTED",
  TORN_WRITE: "EXECUTION_EVENT_SEGMENT_TORN_WRITE",
});

const SESSION_INDEX_FIELDS = Object.freeze(["schemaVersion", "turns"]);

const TURN_INDEX_FIELDS = Object.freeze(["schemaVersion", "segments"]);
const TURN_REFERENCE_FIELDS = Object.freeze(["dialogProcessId"]);
const SEGMENT_FIELDS = Object.freeze([
  "sequence",
  "file",
  "bytes",
  "records",
  "sealed",
  "oversized",
]);

function indexError(code, message) {
  return Object.assign(new Error(message), { code });
}

function corrupted(message) {
  return indexError(EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED, message);
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertKnownFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw corrupted(`${label} has unknown field: ${key}`);
  }
}

export function executionSegmentFileName(sequence) {
  return `segment-${String(sequence).padStart(6, "0")}.jsonl`;
}

export function requireExecutionSegmentSequence(file) {
  const match = typeof file === "string" && /^segment-([0-9]+)\.jsonl$/.exec(file);
  const sequence = match ? Number(match[1]) : NaN;
  if (
    !Number.isSafeInteger(sequence) ||
    sequence <= 0 ||
    executionSegmentFileName(sequence) !== file
  )
    throw corrupted("execution event segment filename is invalid");
  return sequence;
}

const utf8 = new TextEncoder();
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function decodeExecutionSegmentRecordBytes(bytes, file, dialogProcessId) {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError("execution event segment record must be bytes");
  let line;
  try {
    line = strictUtf8.decode(bytes);
  } catch (cause) {
    throw Object.assign(new Error(`execution event segment is invalid UTF-8: ${file}`, { cause }), {
      code: EXECUTION_EVENT_SEGMENT_ERROR_CODE.JSONL_CORRUPTED,
    });
  }
  return decodeExecutionSegmentRecord(line, file, dialogProcessId);
}

export function encodeExecutionSegmentRecord(record) {
  if (!isPlainObject(record)) throw new TypeError("execution event record must be a plain object");
  const line = `${JSON.stringify(record)}\n`;
  return Object.freeze({ line, bytes: utf8.encode(line).length });
}

export function decodeExecutionSegmentRecord(line, file, dialogProcessId) {
  if (typeof line !== "string") throw new TypeError("execution event segment line must be text");
  let record;
  try {
    record = JSON.parse(line);
  } catch (cause) {
    throw Object.assign(new Error(`execution event segment is invalid JSONL: ${file}`, { cause }), {
      code: EXECUTION_EVENT_SEGMENT_ERROR_CODE.JSONL_CORRUPTED,
    });
  }
  if (!isPlainObject(record)) {
    throw indexError(
      EXECUTION_EVENT_SEGMENT_ERROR_CODE.JSONL_CORRUPTED,
      `execution event segment record is not an object: ${file}`,
    );
  }
  if (
    dialogProcessId !== undefined &&
    record.dialogProcessId !== requireDialogProcessKey(dialogProcessId)
  )
    throw indexError(
      EXECUTION_EVENT_SEGMENT_ERROR_CODE.JSONL_CORRUPTED,
      `execution event segment record belongs to a different turn: ${file}`,
    );
  return record;
}

export function executionSegmentTornWrite(file) {
  return indexError(
    EXECUTION_EVENT_SEGMENT_ERROR_CODE.TORN_WRITE,
    `execution event segment has a torn final record: ${file}`,
  );
}

export function decodeExecutionSegment(raw, file) {
  if (typeof raw !== "string") throw new TypeError("execution event segment content must be text");
  if (raw && !raw.endsWith("\n")) throw executionSegmentTornWrite(file);
  const lines = raw ? raw.slice(0, -1).split("\n") : [];
  const records = lines.map((line) => decodeExecutionSegmentRecord(line, file));
  return Object.freeze({ bytes: utf8.encode(raw).length, records: Object.freeze(records) });
}

function requireIndexDocument(index, label, fields) {
  if (!isPlainObject(index)) throw corrupted(`${label} is corrupted`);
  if (index.schemaVersion !== EXECUTION_EVENT_INDEX_SCHEMA_VERSION) {
    throw indexError(
      EXECUTION_EVENT_INDEX_ERROR_CODE.SCHEMA_UNSUPPORTED,
      `${label} schemaVersion ${index.schemaVersion} is unsupported (expected ${EXECUTION_EVENT_INDEX_SCHEMA_VERSION})`,
    );
  }
  assertKnownFields(index, fields, label);
}

export function requireSessionExecutionIndex(index) {
  requireIndexDocument(index, "execution event session index", SESSION_INDEX_FIELDS);
  if (!Array.isArray(index.turns)) throw corrupted("execution event index has no turns");
  const seen = new Set();
  const turns = index.turns.map((turn) => {
    if (!isPlainObject(turn) || !isCanonicalDialogProcessKey(turn.dialogProcessId)) {
      throw corrupted("execution event turn reference is invalid");
    }
    assertKnownFields(turn, TURN_REFERENCE_FIELDS, "execution event turn reference");
    if (seen.has(turn.dialogProcessId)) {
      throw corrupted("execution event turn reference is duplicated");
    }
    seen.add(turn.dialogProcessId);
    return Object.freeze({ dialogProcessId: turn.dialogProcessId });
  });
  return Object.freeze({
    schemaVersion: EXECUTION_EVENT_INDEX_SCHEMA_VERSION,
    turns: Object.freeze(turns),
  });
}

function requireSegment(segment, previous) {
  if (
    !isPlainObject(segment) ||
    !Number.isSafeInteger(segment.sequence) ||
    segment.sequence !== (previous ? previous.sequence + 1 : 1) ||
    segment.file !== executionSegmentFileName(segment.sequence) ||
    !isNonNegativeInteger(segment.bytes) ||
    !isNonNegativeInteger(segment.records) ||
    typeof segment.sealed !== "boolean" ||
    (segment.oversized !== undefined && segment.oversized !== true)
  ) {
    throw corrupted("execution event segment is invalid");
  }
  assertKnownFields(segment, SEGMENT_FIELDS, "execution event segment");
  if (previous && !previous.sealed)
    throw corrupted("execution event segment follows an open segment");
  return Object.freeze({
    sequence: segment.sequence,
    file: segment.file,
    bytes: segment.bytes,
    records: segment.records,
    sealed: segment.sealed,
    ...(segment.oversized ? { oversized: true } : {}),
  });
}

export function requireTurnExecutionIndex(index) {
  requireIndexDocument(index, "execution event turn index", TURN_INDEX_FIELDS);
  return Object.freeze({
    schemaVersion: EXECUTION_EVENT_INDEX_SCHEMA_VERSION,
    segments: requireSegments(index.segments),
  });
}

function requireSegments(list) {
  if (!Array.isArray(list)) throw corrupted("execution event index has no segments");
  const segments = [];
  for (const segment of list) segments.push(requireSegment(segment, segments.at(-1)));
  return Object.freeze(segments);
}

export function createSessionExecutionIndex(turns) {
  return requireSessionExecutionIndex({
    schemaVersion: EXECUTION_EVENT_INDEX_SCHEMA_VERSION,
    turns,
  });
}

export function createTurnExecutionIndex(segments) {
  return requireTurnExecutionIndex({
    schemaVersion: EXECUTION_EVENT_INDEX_SCHEMA_VERSION,
    segments,
  });
}

export const LEGACY_V2_EXECUTION_EVENT_INDEX_SCHEMA_VERSION = 2;
const LEGACY_V2_TURN_INDEX_FIELDS = Object.freeze([
  "schemaVersion",
  "dialogProcessId",
  "activeSequence",
  "maxSegmentBytes",
  "segments",
]);

function requireLegacyV2Document(index, label, fields) {
  if (!isPlainObject(index)) throw corrupted(`${label} is corrupted`);
  if (index.schemaVersion !== LEGACY_V2_EXECUTION_EVENT_INDEX_SCHEMA_VERSION) {
    throw indexError(
      EXECUTION_EVENT_INDEX_ERROR_CODE.SCHEMA_UNSUPPORTED,
      `${label} schemaVersion ${index.schemaVersion} is not v2`,
    );
  }
  assertKnownFields(index, fields, label);
}

export function requireLegacyV2SessionExecutionIndex(index) {
  requireLegacyV2Document(index, "v2 execution event session index", SESSION_INDEX_FIELDS);
  return requireSessionExecutionIndex({
    schemaVersion: EXECUTION_EVENT_INDEX_SCHEMA_VERSION,
    turns: index.turns,
  }).turns;
}

export function requireLegacyV2TurnExecutionIndex(index, dialogProcessId) {
  const label = "v2 execution event turn index";
  requireLegacyV2Document(index, label, LEGACY_V2_TURN_INDEX_FIELDS);
  if (index.dialogProcessId !== dialogProcessId) {
    throw corrupted(`${label} dialogProcessId does not match its directory`);
  }
  if (!Number.isSafeInteger(index.maxSegmentBytes) || index.maxSegmentBytes <= 0) {
    throw corrupted(`${label} maxSegmentBytes is invalid`);
  }
  const segments = requireSegments(index.segments);
  const lastSequence = segments.length ? segments.at(-1).sequence : 0;
  if (index.activeSequence !== lastSequence) {
    throw corrupted(`${label} activeSequence does not match its last segment`);
  }
  return Object.freeze({
    schemaVersion: LEGACY_V2_EXECUTION_EVENT_INDEX_SCHEMA_VERSION,
    dialogProcessId: index.dialogProcessId,
    activeSequence: index.activeSequence,
    maxSegmentBytes: index.maxSegmentBytes,
    segments,
  });
}

export function upgradeLegacyV2TurnExecutionIndex(index, dialogProcessId) {
  return createTurnExecutionIndex(
    requireLegacyV2TurnExecutionIndex(index, dialogProcessId).segments,
  );
}

export function upgradeLegacyV2SessionExecutionIndex(index) {
  return createSessionExecutionIndex(requireLegacyV2SessionExecutionIndex(index));
}
