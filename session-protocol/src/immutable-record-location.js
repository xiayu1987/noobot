/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { immutableStorageError } from "./immutable-storage-error.js";
import { isPlainObject } from "@noobot/shared/value";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { requireImmutableCollection } from "./immutable-collections.js";
import {
  IMMUTABLE_VALUE_BLOCK_BYTES,
  IMMUTABLE_VALUE_MAX_DEPTH,
} from "./immutable-value-limits.js";
import {
  decodeImmutableRecordReference,
  requireImmutableContentDigest,
  requireImmutableRecordReference,
  requireImmutableSegmentTail,
} from "./immutable-segment.js";

export {
  encodeImmutableLocationPage,
  decodeImmutableLocationPage,
  requireImmutableLocationPagePath,
  immutableLocationPageByteLength,
} from "./immutable-location-page.js";

export const IMMUTABLE_JSON_LOCATED_SESSION_FORMAT = "noobot.immutable-session/4";
export const IMMUTABLE_LOCATED_SESSION_FORMAT = "noobot.immutable-session/5";

export function isImmutableLocatedSessionFormat(format) {
  return (
    format === IMMUTABLE_LOCATED_SESSION_FORMAT || format === IMMUTABLE_JSON_LOCATED_SESSION_FORMAT
  );
}

export function requireImmutableLocatedSnapshot(snapshot) {
  if (!snapshot || !isImmutableLocatedSessionFormat(snapshot.format))
    throw immutableStorageError("Located records require their explicit snapshot format");
  requireImmutableSegmentTail(snapshot.segmentTail);
  if (snapshot.locationRoot === null) {
    if (snapshot.generation !== 0 || snapshot.segmentTail !== null)
      throw immutableStorageError("Committed located snapshot requires a location root");
  } else {
    requireImmutableRecordReference(snapshot.locationRoot);
    if (snapshot.segmentTail === null)
      throw immutableStorageError("Location root requires a committed segment tail");
  }
  return snapshot;
}

export function requireImmutableRecordLocation(identity, location) {
  requireImmutableContentDigest(identity);
  if (decodeImmutableRecordReference(location).digest !== identity)
    throw immutableStorageError("Record location disagrees with its content identity");
  return location;
}

export const IMMUTABLE_COMPACTION_BUDGET = Object.freeze({
  records: 128,
  bytes: 1024 * 1024,
});

export const IMMUTABLE_COMPACTION_DISCOVERY = Object.freeze({
  format: "noobot.compaction-cursor/1",
  pages: 32,
  maxPages: 128,
  pathDigits: 64,
});

export function requireImmutableCompactionCursor(cursor, snapshot) {
  requireImmutableLocatedSnapshot(snapshot);
  if (cursor === null) return cursor;
  const fields = ["format", "sessionId", "generation", "locationRoot", "path", "offset"];
  if (
    !isPlainObject(cursor) ||
    Object.keys(cursor).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(cursor, field)) ||
    cursor.format !== IMMUTABLE_COMPACTION_DISCOVERY.format ||
    typeof cursor.path !== "string" ||
    !/^[a-f0-9]{0,64}$/.test(cursor.path) ||
    !Number.isSafeInteger(cursor.offset) ||
    cursor.offset < 0 ||
    cursor.offset > IMMUTABLE_VALUE_BLOCK_BYTES
  )
    throw new TypeError("Invalid compaction discovery cursor");
  if (
    cursor.sessionId !== snapshot.sessionId ||
    cursor.generation !== snapshot.generation ||
    cursor.locationRoot !== snapshot.locationRoot
  )
    throw Object.assign(new Error("Compaction cursor requires its retained snapshot"), {
      code: "SESSION_COMPACTION_CURSOR_SNAPSHOT_MISMATCH",
    });
  return cursor;
}

export function requireImmutableCompactionPageRequest(options, snapshot) {
  const fields = ["cursor", "maxPages", "maxRecords", "signal"];
  if (!isPlainObject(options) || Object.keys(options).some((key) => !fields.includes(key)))
    throw new TypeError("Unknown compaction discovery request field");
  requireImmutableCompactionCursor(options.cursor ?? null, snapshot);
  for (const [field, limit] of [
    ["maxPages", IMMUTABLE_COMPACTION_DISCOVERY.maxPages],
    ["maxRecords", IMMUTABLE_COMPACTION_BUDGET.records],
  ])
    if (
      options[field] !== undefined &&
      (!Number.isSafeInteger(options[field]) || options[field] < 1 || options[field] > limit)
    )
      throw new TypeError(`Compaction discovery requires a bounded ${field}`);
  return options;
}

export function requireImmutableRelocationSource(source) {
  if (
    !isPlainObject(source) ||
    Object.keys(source).length !== 2 ||
    !Object.hasOwn(source, "identity") ||
    !Object.hasOwn(source, "sourceLocation")
  )
    throw new TypeError("Relocation requires identity and sourceLocation");
  requireImmutableRecordLocation(source.identity, source.sourceLocation);
  return source;
}

export function requireImmutableRelocationConflict(conflict) {
  if (
    !isPlainObject(conflict) ||
    Object.keys(conflict).length !== 3 ||
    !Object.hasOwn(conflict, "identity") ||
    !Object.hasOwn(conflict, "sourceLocation") ||
    !Object.hasOwn(conflict, "currentLocation")
  )
    throw new TypeError(
      "Relocation conflict requires identity, sourceLocation and currentLocation",
    );
  requireImmutableRecordLocation(conflict.identity, conflict.sourceLocation);
  if (conflict.currentLocation !== null)
    requireImmutableRecordLocation(conflict.identity, conflict.currentLocation);
  if (conflict.sourceLocation === conflict.currentLocation)
    throw new TypeError("Relocation conflict requires a changed source location");
  return conflict;
}

export function immutableRelocationSourceChanged(source, currentLocation) {
  requireImmutableRelocationSource(source);
  const conflict = requireImmutableRelocationConflict({ ...source, currentLocation });
  return Object.assign(new Error("Relocation source location has changed"), {
    code: "SESSION_RELOCATION_SOURCE_CHANGED",
    conflict,
  });
}

export function requireImmutableCompactionResult(result, records) {
  requireImmutableCompactionRecords(records);
  if (
    !isPlainObject(result) ||
    Object.keys(result).length !== 2 ||
    !Number.isSafeInteger(result.relocatedRecords) ||
    result.relocatedRecords < 0 ||
    !Array.isArray(result.conflicts) ||
    result.relocatedRecords + result.conflicts.length !== records.length
  )
    throw new TypeError("Compaction result must account for every requested source");
  const requested = new Map(records.map((source) => [source.identity, source.sourceLocation]));
  for (const conflict of result.conflicts) {
    requireImmutableRelocationConflict(conflict);
    if (requested.get(conflict.identity) !== conflict.sourceLocation)
      throw new TypeError("Compaction conflict does not identify a unique requested source");
    requested.delete(conflict.identity);
  }
  return result;
}

export function requireImmutableCompactionRecords(records, snapshot) {
  if (
    !Array.isArray(records) ||
    !records.length ||
    records.length > IMMUTABLE_COMPACTION_BUDGET.records
  )
    throw new TypeError("Compaction requires a bounded non-empty record batch");
  if (snapshot !== undefined) requireImmutableLocatedSnapshot(snapshot);
  const identities = new Set();
  let bytes = 0;
  for (const source of records) {
    requireImmutableRelocationSource(source);
    if (identities.has(source.identity)) throw new TypeError("Duplicate compaction record");
    identities.add(source.identity);
    const record = decodeImmutableRecordReference(source.sourceLocation);
    bytes += record.length;
    if (bytes > IMMUTABLE_COMPACTION_BUDGET.bytes)
      throw new TypeError("Compaction source byte budget exceeded");
    if (snapshot && record.segmentId === snapshot.segmentTail?.segmentId)
      throw Object.assign(new Error("Compaction cannot relocate the active append segment"), {
        code: "SESSION_COMPACTION_ACTIVE_SEGMENT",
      });
  }
  return records;
}

export function requireImmutableCompactionRequest(options) {
  const allowed = new Set([
    "storageService",
    "sessionDir",
    "sessionId",
    "assertSessionWritable",
    "signal",
    "operationId",
    "expectedGeneration",
    "records",
  ]);
  if (!isPlainObject(options) || Object.keys(options).some((key) => !allowed.has(key)))
    throw new TypeError("Unknown immutable compaction request field");
  if (!Number.isSafeInteger(options.expectedGeneration) || options.expectedGeneration < 1)
    throw new TypeError("Compaction requires a committed generation");
  requireImmutableCompactionRecords(options.records);
  return options;
}

export const IMMUTABLE_LOCATION_RETIREMENT = Object.freeze({
  directory: "maintenance/location-retirement",
  state: "state.json",
  format: "noobot.location-retirement/4",
  records: 128,
  tasks: 32,
  maxTasks: 128,
  tasksPerPage: 32,
  metadataBytes: LENGTH_THRESHOLDS.immutableStorage.locationRetirementMetadataBytes,
  proofSegments: 64,
});

export function requireImmutableLocationRetirementTask(task) {
  if (!isPlainObject(task)) throw immutableStorageError("Invalid location retirement task");
  let fields;
  if (task.kind === "index") {
    fields = ["kind", "reference", "collection", "prefix"];
    if (typeof task.prefix !== "string" || !/^[a-f0-9]{0,64}$/.test(task.prefix))
      throw immutableStorageError("Invalid location retirement index path");
    if (!["collections", "operations", "scalar"].includes(task.collection))
      requireImmutableCollection(task.collection);
  } else if (task.kind === "collection") {
    fields = ["kind", "reference", "collection", "key"];
    requireImmutableCollection(task.collection);
    if (typeof task.key !== "string" || !task.key)
      throw immutableStorageError("Invalid location retirement collection key");
  } else if (task.kind === "title") {
    fields = ["kind", "reference", "prefix"];
    if (typeof task.prefix !== "string" || !/^[01]{0,53}$/.test(task.prefix))
      throw immutableStorageError("Invalid location retirement title path");
  } else if (task.kind === "raw" || task.kind === "bytes") {
    fields =
      task.kind === "raw"
        ? ["kind", "reference", "bytes"]
        : ["kind", "reference", "bytes", "depth"];
    if (
      !Number.isSafeInteger(task.bytes) ||
      task.bytes < 0 ||
      (task.kind === "raw" && task.bytes > IMMUTABLE_VALUE_BLOCK_BYTES)
    )
      throw immutableStorageError("Invalid location retirement byte count");
    if (
      task.kind === "bytes" &&
      (!Number.isSafeInteger(task.depth) ||
        task.depth < 0 ||
        task.depth > IMMUTABLE_VALUE_MAX_DEPTH)
    )
      throw immutableStorageError("Invalid location retirement byte depth");
  } else if (["page", "commit", "operation"].includes(task.kind)) {
    fields = ["kind", "reference"];
  } else throw immutableStorageError("Invalid location retirement task");
  if (
    Object.keys(task).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(task, field))
  )
    throw immutableStorageError("Invalid location retirement task fields");
  requireImmutableContentDigest(task.reference);
  return task;
}

export function requireImmutableLocationRetirementQueueOffset(reference, offset) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset >= IMMUTABLE_LOCATION_RETIREMENT.tasksPerPage ||
    (reference === null && offset !== 0)
  )
    throw immutableStorageError("Invalid location retirement queue offset");
  if (reference !== null) requireImmutableRecordReference(reference);
  return offset;
}

export function requireImmutableLocationRetirementTaskPage(page) {
  if (
    !isPlainObject(page) ||
    Object.keys(page).length !== 3 ||
    !Array.isArray(page.tasks) ||
    !page.tasks.length ||
    page.tasks.length > IMMUTABLE_LOCATION_RETIREMENT.tasksPerPage
  )
    throw immutableStorageError("Invalid location retirement task page");
  requireImmutableLocationRetirementQueueOffset(page.previous, page.previousOffset);
  for (const task of page.tasks) requireImmutableLocationRetirementTask(task);
  return page;
}

export function requireImmutableLocationRetirementRecords(records) {
  if (
    !Array.isArray(records) ||
    !records.length ||
    records.length > IMMUTABLE_LOCATION_RETIREMENT.records
  )
    throw new TypeError("Location retirement requires a bounded non-empty record batch");
  const identities = new Set();
  for (const source of records) {
    requireImmutableRelocationSource(source);
    if (identities.has(source.identity)) throw new TypeError("Duplicate retirement record");
    identities.add(source.identity);
  }
  return records;
}

export function requireImmutableLocationRetirementRequest(options) {
  const fields = [
    "storageService",
    "sessionDir",
    "sessionId",
    "assertSessionWritable",
    "signal",
    "operationId",
    "expectedGeneration",
    "records",
    "maxTasks",
  ];
  if (!isPlainObject(options) || Object.keys(options).some((key) => !fields.includes(key)))
    throw new TypeError("Unknown immutable location retirement request field");
  if (!Number.isSafeInteger(options.expectedGeneration) || options.expectedGeneration < 1)
    throw new TypeError("Location retirement requires a committed generation");
  requireImmutableLocationRetirementRecords(options.records);
  if (
    options.maxTasks !== undefined &&
    (!Number.isSafeInteger(options.maxTasks) ||
      options.maxTasks < 1 ||
      options.maxTasks > IMMUTABLE_LOCATION_RETIREMENT.maxTasks)
  )
    throw new TypeError("Location retirement requires a bounded task budget");
  return options;
}

export function requireImmutableLocationRetirementResult(result, records) {
  requireImmutableLocationRetirementRecords(records);
  if (
    !isPlainObject(result) ||
    Object.keys(result).length !== 1 ||
    result.retiredRecords !== records.length
  )
    throw new TypeError("Retirement result must account for every requested source");
  return result;
}

export function immutableRecordStillReachable(identity) {
  requireImmutableContentDigest(identity);
  return Object.assign(new Error("Cannot retire a reachable record location"), {
    code: "SESSION_RECORD_STILL_REACHABLE",
    identity,
  });
}

export function requireImmutableLocationRetirementOwner(state, sessionId, request) {
  if (!isPlainObject(state) || state.sessionId !== sessionId)
    throw immutableStorageError("Foreign location retirement proof");
  if (state.operationId !== request.operationId)
    throw Object.assign(new Error("Another location retirement proof owns this session"), {
      code: "SESSION_RETIREMENT_BUSY",
    });
  requireImmutableLocationRetirementRecords(state.records);
  if (
    state.expectedGeneration !== request.expectedGeneration ||
    state.records.length !== request.records.length ||
    state.records.some(
      (source, index) =>
        source.identity !== request.records[index].identity ||
        source.sourceLocation !== request.records[index].sourceLocation,
    )
  )
    throw Object.assign(new Error("Location retirement request changed"), {
      code: "SESSION_OPERATION_CONFLICT",
    });
  return state;
}

export function requireImmutableLocationRetirementState(state) {
  if (
    !isPlainObject(state) ||
    state.format !== IMMUTABLE_LOCATION_RETIREMENT.format ||
    typeof state.sessionId !== "string" ||
    !state.sessionId ||
    typeof state.operationId !== "string" ||
    !state.operationId ||
    !Number.isSafeInteger(state.expectedGeneration) ||
    state.expectedGeneration < 1 ||
    !Number.isSafeInteger(state.observedGeneration) ||
    state.observedGeneration < 0 ||
    !Number.isSafeInteger(state.processed) ||
    state.processed < 0 ||
    !(
      state.publicationGeneration === null ||
      (Number.isSafeInteger(state.publicationGeneration) &&
        state.publicationGeneration >= state.expectedGeneration)
    )
  )
    throw immutableStorageError("Invalid location retirement proof state");
  requireImmutableLocationRetirementRecords(state.records);
  requireImmutableLocationRetirementQueueOffset(state.queue, state.queueOffset);
  if (state.seen !== null) requireImmutableRecordReference(state.seen);
  requireImmutableSegmentTail(state.segmentTail);
  if (state.observedGeneration !== 0 && state.observedGeneration < state.expectedGeneration)
    throw immutableStorageError(
      "Location retirement observation predates its requested generation",
    );
  if (
    state.observedGeneration === 0 &&
    (state.processed !== 0 ||
      state.queue !== null ||
      state.seen !== null ||
      state.segmentTail !== null ||
      state.publicationGeneration !== null)
  )
    throw immutableStorageError("Unstarted location retirement proof contains progress");
  if (state.observedGeneration !== 0 && (state.processed === 0 || state.seen === null))
    throw immutableStorageError("Location retirement observation requires marking progress");
  if (
    state.publicationGeneration !== null &&
    state.publicationGeneration !== state.observedGeneration
  )
    throw immutableStorageError("Location retirement publication requires its observed generation");
  if ((state.queue !== null || state.seen !== null) && state.segmentTail === null)
    throw immutableStorageError("Location retirement pages require an append boundary");
  if (state.publicationGeneration !== null && state.queue !== null)
    throw immutableStorageError("Incomplete location retirement proof cannot publish");
  return state;
}
