/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { isCanonicalDialogProcessKey } from "../identity.js";

export const EXECUTION_EVENT_INDEX_SCHEMA_VERSION = 3;

export const EXECUTION_EVENT_INDEX_FILE = "index.json";
export const EXECUTION_EVENT_TURNS_DIR = "turns";

export const EXECUTION_EVENT_INDEX_ERROR_CODE = Object.freeze({
  CORRUPTED: "EXECUTION_EVENT_INDEX_CORRUPTED",
  SCHEMA_UNSUPPORTED: "EXECUTION_EVENT_INDEX_SCHEMA_UNSUPPORTED",
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

const utf8 = new TextEncoder();

export function encodeExecutionSegmentRecord(record) {
  if (!isPlainObject(record)) throw new TypeError("execution event record must be a plain object");
  const line = `${JSON.stringify(record)}\n`;
  return Object.freeze({ line, bytes: utf8.encode(line).length });
}

export function decodeExecutionSegmentRecord(line, file) {
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
    segment.sequence <= (previous ? previous.sequence : 0) ||
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
