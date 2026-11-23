/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { Buffer } from "node:buffer";
import { sessionRequestDigest } from "./session-request-digest.js";
import { isPlainObject } from "@noobot/shared/value";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { IMMUTABLE_VALUE_BLOCK_BYTES } from "./immutable-value-limits.js";
export {
  IMMUTABLE_VALUE_BLOCK_BYTES,
  IMMUTABLE_VALUE_MAX_DEPTH,
} from "./immutable-value-limits.js";
import { immutableStorageContextDirectory } from "./immutable-context-directory-adapter.js";
import { requireSessionOperationId } from "./session-changes.js";
import { requireImmutableOperationReceipt } from "./immutable-operation-receipt.js";
import {
  immutableStorageError,
  requireImmutableCollection,
  requireObjectReference,
} from "./immutable-storage.js";

export const IMMUTABLE_COMMIT_INDEX_VERSION = 4;
export const IMMUTABLE_CONTEXT_INDEX_VERSION = 6;
export const IMMUTABLE_ARTIFACT_EVENT_INDEX_VERSION = 1;

export function requireImmutableContextIndex(facts) {
  if (facts?.contextIndexVersion !== IMMUTABLE_CONTEXT_INDEX_VERSION)
    throw Object.assign(new Error("Immutable context indexes require an offline upgrade"), {
      code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
    });
  return facts;
}

export function requireImmutableArtifactEventIndex(
  value,
  requireReference = requireObjectReference,
) {
  if (value === null || value === undefined)
    throw Object.assign(new Error("Immutable artifact event index requires an offline upgrade"), {
      code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
    });
  if (!isPlainObject(value) || value.version !== IMMUTABLE_ARTIFACT_EVENT_INDEX_VERSION)
    throw immutableStorageError("Invalid immutable artifact event index version");
  indexReference(value, { field: "root", role: "events", countField: "count" }, requireReference);
  return value;
}

export const IMMUTABLE_WRAPPED_COMMIT_INDEX_VERSIONS = Object.freeze([2, 3]);
export function requireImmutableWrappedCommitReference(value, requireReference) {
  requireReference(value);
  return value;
}
export const IMMUTABLE_COMMIT_ORIGIN_COLLECTIONS = Object.freeze({
  commands: "commandCommits",
  checkpoints: "checkpointCommits",
});

export function immutableMigrationCommitOrigins(version) {
  if (!IMMUTABLE_WRAPPED_COMMIT_INDEX_VERSIONS.includes(version))
    throw immutableStorageError("Unsupported migration commit index version");
  return version === 2
    ? Object.freeze({ commands: "commandCommits" })
    : IMMUTABLE_COMMIT_ORIGIN_COLLECTIONS;
}

export function createImmutableCommitOrigin(generation) {
  if (!Number.isSafeInteger(generation) || generation < 1)
    throw immutableStorageError("Commit origin requires a positive generation");
  return { kind: generation === 1 ? "baseline" : "commit", generation };
}

export function requireImmutableCommitOrigin(origin, generation) {
  if (
    !isPlainObject(origin) ||
    Object.keys(origin).length !== 2 ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !Number.isSafeInteger(origin.generation) ||
    origin.generation < 1 ||
    origin.generation > generation ||
    origin.kind !== (origin.generation === 1 ? "baseline" : "commit")
  )
    throw immutableStorageError("Invalid indexed commit origin");
  return origin;
}

export function requireImmutableCheckpointOriginGeneration(originGeneration, maximumGeneration) {
  if (originGeneration === undefined)
    throw Object.assign(new Error("Immutable checkpoint receipts require an offline upgrade"), {
      code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
    });
  if (
    !Number.isSafeInteger(originGeneration) ||
    originGeneration < 1 ||
    originGeneration > maximumGeneration
  )
    throw immutableStorageError("Invalid immutable checkpoint origin generation");
  return originGeneration;
}

export const IMMUTABLE_TRANSACTION_BUDGET = Object.freeze({
  bytes: 64 * 1024 * 1024,
  objects: 65536,
});

export const IMMUTABLE_MESSAGE_FIELDS_UPGRADE_BATCH = Object.freeze({
  records: 32,
  bytes: IMMUTABLE_TRANSACTION_BUDGET.bytes / 4,
});

export const IMMUTABLE_TRANSACTION_READ_CACHE = Object.freeze({
  bytes: 4 * 1024 * 1024,
  records: 4096,
});

export function freezeImmutableIndexPage(page) {
  if (page.kind === "index-leaf") {
    for (const entry of page.entries) Object.freeze(entry);
    Object.freeze(page.entries);
  } else if (page.kind === "index-branch") Object.freeze(page.children);
  else throw immutableStorageError("Cannot freeze an invalid immutable index page");
  return Object.freeze(page);
}

export const IMMUTABLE_VALUE_READ_BATCH_RECORDS = Math.max(
  1,
  Math.floor((1024 * 1024) / IMMUTABLE_VALUE_BLOCK_BYTES),
);

export const IMMUTABLE_VALUE_INLINE_BYTES = LENGTH_THRESHOLDS.immutableStorage.valueInlineBytes;

export const IMMUTABLE_INDEX_TARGET_BYTES = LENGTH_THRESHOLDS.immutableStorage.indexTargetBytes;

export const IMMUTABLE_COMMIT_INDEX_TARGET_BYTES =
  LENGTH_THRESHOLDS.immutableStorage.commitIndexTargetBytes;
export const IMMUTABLE_LOCATION_INDEX_TARGET_BYTES =
  LENGTH_THRESHOLDS.immutableStorage.locationIndexTargetBytes;

export function requireImmutableSessionChange(change, requireReference = requireObjectReference) {
  if (!isPlainObject(change)) throw new TypeError("Invalid immutable session change");
  requireImmutableCollection(change.collection);
  if (typeof change.key !== "string" || !change.key)
    throw new TypeError("Invalid immutable session change key");
  const sources = ["value", "reference", "remove"].filter((key) => Object.hasOwn(change, key));
  if (sources.length !== 1 || (sources[0] === "remove" && change.remove !== true))
    throw new TypeError("Immutable session change requires exactly one value source");
  if (sources[0] === "reference") requireReference(change.reference);
  if (Object.hasOwn(change, "parts") && sources[0] !== "value")
    throw new TypeError("Only new values may reuse content parts");
  return change;
}

export function immutableValueSplitOffset(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes <= IMMUTABLE_VALUE_BLOCK_BYTES)
    throw immutableStorageError("Invalid immutable value branch size");
  return (
    IMMUTABLE_VALUE_BLOCK_BYTES *
    2 ** Math.floor(Math.log2(Math.ceil(bytes / IMMUTABLE_VALUE_BLOCK_BYTES) - 1))
  );
}

export function isImmutableValueBytePage(page) {
  return ["value", "value-inline", "value-branch"].includes(page?.kind);
}

export function requireImmutableValueBytePage(page, actualBytes = page?.bytes) {
  if (
    !isPlainObject(page) ||
    !isImmutableValueBytePage(page) ||
    !Number.isSafeInteger(page.bytes) ||
    page.bytes < 0 ||
    page.bytes !== actualBytes ||
    (page.kind === "value-inline"
      ? page.bytes > IMMUTABLE_VALUE_INLINE_BYTES
      : page.kind === "value"
        ? page.bytes > IMMUTABLE_VALUE_BLOCK_BYTES
        : page.kind !== "value-branch" || page.bytes <= IMMUTABLE_VALUE_BLOCK_BYTES)
  )
    throw immutableStorageError("Invalid immutable value size or page");
  if (page.kind === "value-inline") decodeImmutableInlineValue(page);
  return page;
}

export function requireImmutableValueBranchChildren(page, left, right) {
  requireImmutableValueBytePage(left);
  requireImmutableValueBytePage(right);
  requireImmutableValueBytePage(page, left.bytes + right.bytes);
  if (page.kind !== "value-branch" || left.bytes === 0 || right.bytes === 0)
    throw immutableStorageError("Invalid immutable value branch size");
  return page;
}

export function decodeImmutableInlineValue(page) {
  if (
    !isPlainObject(page) ||
    page.kind !== "value-inline" ||
    Object.keys(page).length !== 3 ||
    !Number.isSafeInteger(page.bytes) ||
    page.bytes < 0 ||
    page.bytes > IMMUTABLE_VALUE_INLINE_BYTES ||
    typeof page.data !== "string" ||
    page.data.length > Math.ceil(IMMUTABLE_VALUE_INLINE_BYTES / 3) * 4
  )
    throw immutableStorageError("Invalid immutable inline value");
  const bytes = Buffer.from(page.data, "base64");
  if (bytes.length !== page.bytes || bytes.toString("base64") !== page.data)
    throw immutableStorageError("Invalid immutable inline value encoding");
  return bytes;
}

const MESSAGE_CONTENT_PATHS = Object.freeze(
  [
    "content",
    "rawModelContent",
    "modelAdditionalKwargs",
    "modelResponseMetadata",
    "toolTimeline",
  ].map((field) => Object.freeze(["message", field])),
);
const NO_CONTENT_PATHS = Object.freeze([]);

export const IMMUTABLE_MESSAGE_DISPLAY_VERSION = 1;

export function requireImmutableMessageDisplay(display) {
  if (
    !isPlainObject(display) ||
    display.version !== IMMUTABLE_MESSAGE_DISPLAY_VERSION ||
    !Array.isArray(display.toolTimeline)
  )
    throw immutableStorageError("Invalid immutable message display index; run workspace migration");
  return display;
}

export function immutableValueContentPaths(collection) {
  requireImmutableCollection(collection);
  return collection === "messages" ? MESSAGE_CONTENT_PATHS : NO_CONTENT_PATHS;
}

export function requireImmutableMessageContentPart(parts) {
  const part = parts.find(({ path }) => path[0] === "message" && path[1] === "content");
  if (!part) throw immutableStorageError("Message requires its canonical content part");
  return part;
}

export { sessionRequestDigest as immutableTransactionInputDigest };

export function requireImmutableOperationInputEvidence(receipt, evidence) {
  if (
    !isPlainObject(evidence) ||
    Object.keys(evidence).length !== 2 ||
    !Object.hasOwn(evidence, "input") ||
    !Number.isSafeInteger(evidence.expectedGeneration) ||
    evidence.expectedGeneration < 0 ||
    sessionRequestDigest(evidence.expectedGeneration, evidence.input) !== receipt.digest
  )
    throw immutableStorageError("Operation input evidence disagrees with its persisted digest");
  return evidence.input;
}

export function requireImmutableMessageResult(result) {
  if (
    !Array.isArray(result) ||
    result.some((uid) => typeof uid !== "string" || !uid.trim() || uid.trim() !== uid)
  )
    throw immutableStorageError("Invalid immutable message result identities");
  return result;
}

export function immutableCheckpointMessageResult(checkpoint) {
  return requireImmutableMessageResult([
    ...new Set(
      [
        ...checkpoint.messages,
        ...(checkpoint.messageContentAppends ?? []),
        ...(checkpoint.messageMetadataUpdates ?? []),
      ].map((message) => message.messageUid),
    ),
  ]);
}

export function migrateImmutableMessageResult(result, sessionId, mutations) {
  if (!Array.isArray(result))
    throw immutableStorageError("Invalid immutable message result migration source");
  const legacy = result.length > 0 && isPlainObject(result[0]);
  const identities = requireImmutableMessageResult(
    legacy
      ? result.map((message) => {
          if (!isPlainObject(message) || message.sessionId !== sessionId)
            throw immutableStorageError("Message receipt migration ownership mismatch");
          return message.messageUid;
        })
      : result,
  );
  const committed = new Set(
    mutations
      .filter((mutation) => mutation.collection === "messages" && mutation.reference !== null)
      .map((mutation) => mutation.key),
  );
  if (identities.some((uid) => !committed.has(uid)))
    throw immutableStorageError("Message receipt identity is absent from its original commit");
  return identities;
}

export function requireImmutableListFacts(facts) {
  if (
    !isPlainObject(facts) ||
    !Number.isSafeInteger(facts.messageCount) ||
    facts.messageCount < 0 ||
    typeof facts.lastMessageUid !== "string" ||
    (facts.messageCount === 0 ? facts.lastMessageUid !== "" : !facts.lastMessageUid.trim())
  )
    throw immutableStorageError("Immutable list facts are missing or inconsistent");
  return facts;
}

export function requireImmutableContentReuse(
  value,
  parts,
  paths,
  requireReference = requireObjectReference,
) {
  if (!Array.isArray(parts)) throw immutableStorageError("Invalid immutable reused content");
  const seen = new Set();
  for (const part of parts) {
    const key = JSON.stringify(part?.path);
    if (
      !isPlainObject(part) ||
      Object.keys(part).length !== 2 ||
      !paths.some((path) => JSON.stringify(path) === key) ||
      seen.has(key) ||
      !isPlainObject(value?.[part.path[0]]) ||
      value[part.path[0]][part.path[1]] !== null
    )
      throw immutableStorageError("Invalid immutable reused content slot");
    seen.add(key);
    requireReference(part.reference);
  }
  return parts;
}

export function isImmutableValuePartsPage(page) {
  return page?.kind === "value-parts" || page?.kind === "value-parts-inline";
}

export function immutableInlineValueParts(value, parts) {
  const page = { kind: "value-parts-inline", value, parts };
  return Buffer.byteLength(JSON.stringify(page)) <= IMMUTABLE_VALUE_BLOCK_BYTES ? page : null;
}

export function requireImmutableValueParts(page, requireReference = requireObjectReference) {
  if (
    !isPlainObject(page) ||
    !isImmutableValuePartsPage(page) ||
    Object.keys(page).length !== 3 ||
    !Array.isArray(page.parts) ||
    page.parts.length < 1 ||
    page.parts.length > MESSAGE_CONTENT_PATHS.length
  )
    throw immutableStorageError("Invalid immutable value parts");
  if (page.kind === "value-parts") requireReference(page.template);
  else if (!isPlainObject(page.value) || !immutableInlineValueParts(page.value, page.parts))
    throw immutableStorageError("Invalid immutable inline value parts");
  let previous = -1;
  for (const part of page.parts) {
    const index = MESSAGE_CONTENT_PATHS.findIndex(
      (path) => JSON.stringify(part?.path) === JSON.stringify(path),
    );
    if (!isPlainObject(part) || Object.keys(part).length !== 2 || index <= previous)
      throw immutableStorageError("Invalid immutable value part path");
    requireReference(part.reference);
    previous = index;
  }
  return page;
}

export function immutablePageReferencePaths(page, requireReference = requireObjectReference) {
  let paths;
  switch (page?.kind) {
    case "value-parts-inline":
    case "value-parts":
      requireImmutableValueParts(page, requireReference);
      paths = [
        ...(page.kind === "value-parts" ? [["template"]] : []),
        ...Array.from(page.parts.keys(), (index) => ["parts", index, "reference"]),
      ];
      break;
    case "value-inline":
      decodeImmutableInlineValue(page);
      paths = [];
      break;
    case "value":
      paths = [["data"]];
      break;
    case "value-branch":
      paths = [["left"], ["right"]];
      break;
    case "index-leaf":
      if (!Array.isArray(page.entries)) throw immutableStorageError("Invalid index entries");
      paths = Array.from(page.entries.keys(), (index) => ["entries", index, 1]);
      break;
    case "index-branch":
      if (!isPlainObject(page.children)) throw immutableStorageError("Invalid index children");
      paths = Object.keys(page.children)
        .sort()
        .map((digit) => ["children", digit]);
      break;
    case "title-branch":
      paths = [["zero"], ["one"]];
      break;
    case "title-candidate":
      paths = [];
      break;
    default:
      throw immutableStorageError("Unknown immutable storage page kind");
  }
  return paths;
}

function referenceOwner(shape, path) {
  let owner = shape;
  for (const key of path.slice(0, -1)) {
    owner = owner?.[key];
    if (owner === undefined) throw immutableStorageError("Invalid immutable reference path");
  }
  return owner;
}

export function splitImmutablePageReferences(page, requireReference = requireObjectReference) {
  const paths = immutablePageReferencePaths(page, requireReference);
  const shape = JSON.parse(JSON.stringify(page));
  const references = [];
  for (const path of paths) {
    const owner = referenceOwner(shape, path);
    const key = path.at(-1);
    references.push(requireReference(owner[key]));
    owner[key] = null;
  }
  return { shape, references };
}

export function immutablePageReferences(page, requireReference = requireObjectReference) {
  return immutablePageReferencePaths(page, requireReference).map((path) =>
    requireReference(path.reduce((owner, key) => owner?.[key], page)),
  );
}

const MEMBER_COLLECTIONS = new Set([
  "dialogTurns",
  "contextTurns",
  "turnCheckpoints",
  "messageCheckpoints",
  "turnOutbox",
  "turnCommands",
]);

function indexReference(value, { field, role, countField }, requireReference) {
  if (!isPlainObject(value) || !Object.hasOwn(value, field))
    throw immutableStorageError(`Missing immutable index reference: ${field}`);
  const reference = value[field];
  const count = countField === undefined ? undefined : value[countField];
  if (reference !== null) requireReference(reference);
  if (
    countField !== undefined &&
    (!Number.isSafeInteger(count) || count < 0 || (reference === null) !== (count === 0))
  )
    throw immutableStorageError(`Invalid immutable index count: ${field}`);
  return { reference, role, count };
}

export function immutableValueIndexLayout(collection, key) {
  requireImmutableCollection(collection);
  if (collection === "turns")
    return [
      { field: "messagesRoot", role: "messages", countField: "messageCount" },
      { field: "messageOrderRoot", role: "scalar", countField: "messageCount" },
    ];
  if (MEMBER_COLLECTIONS.has(collection))
    return [{ field: "root", role: "scalar", countField: "count" }];
  if (collection === "contextSources")
    return [{ field: "root", role: "messages", countField: "count" }];
  if (collection === "toolPairs")
    return [{ field: "resultsRoot", role: "scalar", countField: "resultCount" }];
  if (collection === "metadata" && key === "titleIndex") return [{ field: "root", role: "title" }];
  if (collection === "metadata" && key === "artifactEventIndex")
    return [{ field: "root", role: "events", countField: "count" }];
  return [];
}

function requireValueIndexLayout(collection, key, value) {
  const layout = immutableValueIndexLayout(collection, key);
  if (collection === "contextSources") {
    const directory = immutableStorageContextDirectory.requirePage(value?.directory, "");
    if (
      !isPlainObject(value) ||
      Object.keys(value).length !== 3 ||
      (Object.hasOwn(directory, "ordinals")
        ? value.count !== directory.ordinals.length
        : value.count < directory.slots.length)
    )
      throw immutableStorageError("Invalid immutable context source descriptor");
  }
  return layout;
}

export function immutableValueIndexReferences(
  collection,
  key,
  value,
  requireReference = requireObjectReference,
) {
  return requireValueIndexLayout(collection, key, value).map((layout) =>
    indexReference(value, layout, requireReference),
  );
}

function requireCommitMutations(mutations, requireReference) {
  const seen = new Set();
  for (const mutation of mutations) {
    if (!isPlainObject(mutation) || Object.keys(mutation).length !== 3)
      throw new TypeError("Invalid session commit mutation");
    requireImmutableCollection(mutation.collection);
    if (typeof mutation.key !== "string" || !mutation.key)
      throw new TypeError("Invalid session commit mutation key");
    const key = JSON.stringify([mutation.collection, mutation.key]);
    if (seen.has(key)) throw new TypeError("Duplicate session commit mutation");
    seen.add(key);
    if (mutation.reference !== null) requireReference(mutation.reference);
  }
}

export function requireImmutableCommitRecord(
  record,
  generation,
  requireReference = requireObjectReference,
) {
  if (
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !isPlainObject(record) ||
    Object.keys(record).length !== 4 ||
    record.generation !== generation ||
    !Array.isArray(record.mutations) ||
    (generation === 1 ? record.previous !== null : typeof record.previous !== "string")
  )
    throw immutableStorageError("Invalid indexed session commit");
  try {
    requireSessionOperationId(record.operationId);
    if (record.previous !== null) requireReference(record.previous);
    requireCommitMutations(record.mutations, requireReference);
  } catch (cause) {
    throw immutableStorageError("Invalid indexed session commit mutations", cause);
  }
  return record;
}

export function immutableCommitReferenceEdges(record, requireReference = requireObjectReference) {
  requireImmutableCommitRecord(record, record?.generation, requireReference);
  return [
    { path: ["previous"], kind: "commit", reference: record.previous },
    ...record.mutations.map(({ collection, key, reference }, index) => ({
      path: ["mutations", index, "reference"],
      kind: "collection",
      collection,
      key,
      reference,
    })),
  ];
}

export function immutableOperationReceiptReferenceEdges(
  receipt,
  requireReference = requireObjectReference,
) {
  requireImmutableOperationReceipt(receipt, receipt?.generation, requireReference);
  return [{ path: ["commit"], kind: "commit", reference: receipt.commit }];
}

export function immutableCollectionValueReferenceEdges(
  collection,
  key,
  value,
  requireReference = requireObjectReference,
) {
  requireImmutableCollection(collection);

  if (collection === "commitOrder") return immutableCommitReferenceEdges(value, requireReference);
  return requireValueIndexLayout(collection, key, value).map((layout) => ({
    path: [layout.field],
    kind: "index",
    ...indexReference(value, layout, requireReference),
  }));
}

export function immutableCommitReferences(record, requireReference = requireObjectReference) {
  return immutableCommitReferenceEdges(record, requireReference).map(({ reference }) => reference);
}

export function immutableOperationReceiptReferences(
  receipt,
  requireReference = requireObjectReference,
) {
  return immutableOperationReceiptReferenceEdges(receipt, requireReference).map(
    ({ reference }) => reference,
  );
}

export function immutableCollectionValueReferences(
  collection,
  key,
  value,
  requireReference = requireObjectReference,
) {
  return immutableCollectionValueReferenceEdges(collection, key, value, requireReference).map(
    ({ reference }) => reference,
  );
}
