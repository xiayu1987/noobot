/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject, text } from "@noobot/shared/value";
import { createLocator, isCanonicalLocator } from "@noobot/shared/locator";

export const FILE_MUTATION_PROTOCOL = "noobot.file-mutation-result";
export const FILE_MUTATION_VERSION = 3;

export const MUTATION_SNAPSHOT_STATE = Object.freeze({
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
  DELETED: "deleted",
});

const MUTATION_OPERATIONS = Object.freeze(["create", "replace", "update", "delete"]);
const SNAPSHOT_STATES = Object.freeze(Object.values(MUTATION_SNAPSHOT_STATE));

export const FILE_MUTATION_ERROR_CODE = Object.freeze({
  RECORD_NOT_FOUND: "file_mutation_not_found",
  INVALID_ID: "file_mutation_invalid_id",
  INVALID_DOWNLOAD_REQUEST: "file_mutation_invalid_download_request",
  TARGET_NOT_FOUND: "file_mutation_target_not_found",
  CONFLICT: "file_mutation_conflict",
  ALREADY_EXISTS: "file_mutation_already_exists",
  COMMIT_FAILED: "file_mutation_commit_failed",
  COMMIT_AND_ROLLBACK_FAILED: "file_mutation_commit_and_rollback_failed",
  ROLLBACK_CONFLICT: "file_mutation_rollback_conflict",
  SNAPSHOT_OVERWRITTEN: "snapshot_overwritten",
  SNAPSHOT_UNAVAILABLE: "snapshot_unavailable",
  RESOURCE_DELETED: "resource_deleted",
  SNAPSHOT_CORRUPT: "file_mutation_snapshot_corrupt",
});

export const FILE_MUTATION_ERROR_STATUS = Object.freeze({
  [FILE_MUTATION_ERROR_CODE.RECORD_NOT_FOUND]: 404,
  [FILE_MUTATION_ERROR_CODE.INVALID_ID]: 400,
  [FILE_MUTATION_ERROR_CODE.INVALID_DOWNLOAD_REQUEST]: 400,
  [FILE_MUTATION_ERROR_CODE.TARGET_NOT_FOUND]: 404,
  [FILE_MUTATION_ERROR_CODE.CONFLICT]: 409,
  [FILE_MUTATION_ERROR_CODE.ALREADY_EXISTS]: 409,
  [FILE_MUTATION_ERROR_CODE.COMMIT_FAILED]: 500,
  [FILE_MUTATION_ERROR_CODE.COMMIT_AND_ROLLBACK_FAILED]: 500,
  [FILE_MUTATION_ERROR_CODE.ROLLBACK_CONFLICT]: 409,
  [FILE_MUTATION_ERROR_CODE.SNAPSHOT_OVERWRITTEN]: 409,
  [FILE_MUTATION_ERROR_CODE.SNAPSHOT_UNAVAILABLE]: 409,
  [FILE_MUTATION_ERROR_CODE.RESOURCE_DELETED]: 410,
  [FILE_MUTATION_ERROR_CODE.SNAPSHOT_CORRUPT]: 500,
});

export function createFileMutationError(code, message, { cause, details } = {}) {
  const statusCode = FILE_MUTATION_ERROR_STATUS[code];
  if (statusCode === undefined) throw new TypeError(`unknown file mutation error code: ${code}`);
  const error = cause === undefined ? new Error(message) : new Error(message, { cause });
  error.code = code;
  error.statusCode = statusCode;
  if (details !== undefined) error.details = details;
  return error;
}

export function createFileMutationLocator(value) {
  return createLocator(value);
}

function linesOf(value = "") {
  const lines = String(value).split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function createFileDiff(before = "", after = "") {
  const oldLines = linesOf(before);
  const newLines = linesOf(after);
  const width = newLines.length + 1;
  const table = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(width));
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1)
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1)
      table[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? table[oldIndex + 1][newIndex + 1] + 1
          : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
  const rows = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length &&
      newIndex < newLines.length &&
      oldLines[oldIndex] === newLines[newIndex]
    ) {
      rows.push({
        type: "context",
        oldLine: oldIndex + 1,
        newLine: newIndex + 1,
        text: oldLines[oldIndex],
      });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      newIndex < newLines.length &&
      (oldIndex === oldLines.length ||
        table[oldIndex][newIndex + 1] > table[oldIndex + 1][newIndex])
    ) {
      rows.push({
        type: "added",
        oldLine: null,
        newLine: newIndex + 1,
        text: newLines[newIndex++],
      });
    } else {
      rows.push({
        type: "removed",
        oldLine: oldIndex + 1,
        newLine: null,
        text: oldLines[oldIndex++],
      });
    }
  }
  const additions = rows.filter((row) => row.type === "added").length;
  const deletions = rows.filter((row) => row.type === "removed").length;
  return {
    format: "git-lines-v1",
    additions,
    deletions,
    changedLines: additions + deletions,
    lines: rows,
  };
}

export function createFileMutationResult({
  id,
  operation,
  locator,
  fileName,
  before,
  after,
  diff,
  aggregate = null,
  sessionScope,
  updatedAt,
}) {
  if (sessionScope !== null && !isPlainObject(sessionScope)) {
    throw new TypeError("file mutation sessionScope must be null or a persistence scope object");
  }
  const { lines: _lines, ...diffSummary } = diff || {};
  const mutation = {
    id,
    operation,
    locator: createFileMutationLocator(locator),
    fileName,
    before,
    after,
    diff: diff ? diffSummary : null,
    aggregate: aggregate || null,
    ...(sessionScope ? { sessionScope } : {}),
    updatedAt: updatedAt || new Date().toISOString(),
  };
  return {
    protocol: FILE_MUTATION_PROTOCOL,
    version: FILE_MUTATION_VERSION,
    ok: true,
    mutations: [mutation],
  };
}

function isInvalidAggregate(aggregate) {
  if (aggregate === null || aggregate === undefined) return false;
  return (
    !aggregate ||
    !text(aggregate.scopeId) ||
    !Number.isInteger(aggregate.revision) ||
    aggregate.revision < 1 ||
    !Number.isInteger(aggregate.diffCount) ||
    aggregate.diffCount < 1
  );
}

function isSha256OrNull(value) {
  return value === null || (typeof value === "string" && value.length > 0);
}

function isValidBeforeMeta(before) {
  return (
    isPlainObject(before) &&
    typeof before.exists === "boolean" &&
    isSha256OrNull(before.sha256) &&
    before.exists === (before.sha256 !== null)
  );
}

function isValidAfterMeta(after) {
  return (
    isPlainObject(after) &&
    typeof after.exists === "boolean" &&
    typeof after.isText === "boolean" &&
    Number.isInteger(after.size) &&
    after.size >= 0 &&
    isSha256OrNull(after.sha256) &&
    after.exists === (after.sha256 !== null)
  );
}

function isValidDiffSummary(diff) {
  if (diff === null) return true;
  return (
    isPlainObject(diff) &&
    Number.isInteger(diff.additions) &&
    diff.additions >= 0 &&
    Number.isInteger(diff.deletions) &&
    diff.deletions >= 0
  );
}

function isInvalidMutation(mutation) {
  return (
    !mutation?.id ||
    !MUTATION_OPERATIONS.includes(mutation.operation) ||
    !isCanonicalLocator(mutation.locator) ||
    typeof mutation.fileName !== "string" ||
    !mutation.fileName ||
    !isValidBeforeMeta(mutation.before) ||
    !isValidAfterMeta(mutation.after) ||
    !isValidDiffSummary(mutation.diff) ||
    isInvalidAggregate(mutation.aggregate)
  );
}

function assertFileMutationEnvelope(value) {
  if (
    !value ||
    value.protocol !== FILE_MUTATION_PROTOCOL ||
    value.version !== FILE_MUTATION_VERSION ||
    value.ok !== true ||
    !Array.isArray(value.mutations) ||
    value.mutations.some(isInvalidMutation)
  ) {
    throw new TypeError("invalid file mutation result");
  }
  return value;
}

export function assertFileMutationResult(value) {
  assertFileMutationEnvelope(value);
  if (!value.mutations.length) throw new TypeError("invalid file mutation result");
  return value;
}

function snapshotStateOf(mutation) {
  if (!mutation.after.exists) return MUTATION_SNAPSHOT_STATE.DELETED;
  return mutation.after.snapshotRef
    ? MUTATION_SNAPSHOT_STATE.AVAILABLE
    : MUTATION_SNAPSHOT_STATE.UNAVAILABLE;
}

function revisionOf(mutation) {
  return mutation.aggregate ? mutation.aggregate.revision : 1;
}

function projectMutationRef(mutation) {
  return Object.freeze({
    mutationId: mutation.id,
    revision: revisionOf(mutation),
    operation: mutation.operation,
    locator: Object.freeze({ view: mutation.locator.view, path: mutation.locator.path }),
    fileName: mutation.fileName,
    beforeSha256: mutation.before.sha256,
    afterSha256: mutation.after.sha256,
    size: mutation.after.size,
    additions: mutation.diff === null ? null : mutation.diff.additions,
    deletions: mutation.diff === null ? null : mutation.diff.deletions,
    snapshot: snapshotStateOf(mutation),
    ...(mutation.sessionScope ? { sessionScope: mutation.sessionScope } : {}),
  });
}

export function projectMutationRefs(value) {
  if (!isPlainObject(value) || value.protocol !== FILE_MUTATION_PROTOCOL) return [];
  return assertFileMutationEnvelope(value).mutations.map(projectMutationRef);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function hasMutationRefIdentity(value) {
  return (
    Boolean(text(value.mutationId)) &&
    Number.isInteger(value.revision) &&
    value.revision >= 1 &&
    MUTATION_OPERATIONS.includes(value.operation) &&
    isCanonicalLocator(value.locator) &&
    typeof value.fileName === "string" &&
    Boolean(value.fileName)
  );
}

function hasMutationRefDiffStats(value) {
  if (value.additions === null || value.deletions === null) {
    return value.additions === null && value.deletions === null;
  }
  return isNonNegativeInteger(value.additions) && isNonNegativeInteger(value.deletions);
}

function hasMutationRefSnapshot(value) {
  return (
    isSha256OrNull(value.beforeSha256) &&
    isSha256OrNull(value.afterSha256) &&
    isNonNegativeInteger(value.size) &&
    SNAPSHOT_STATES.includes(value.snapshot) &&
    (value.snapshot === MUTATION_SNAPSHOT_STATE.DELETED) === (value.afterSha256 === null)
  );
}

export function isMutationRef(value) {
  return (
    isPlainObject(value) &&
    hasMutationRefIdentity(value) &&
    hasMutationRefSnapshot(value) &&
    hasMutationRefDiffStats(value) &&
    (value.sessionScope === undefined || isPlainObject(value.sessionScope))
  );
}

export function assertMutationRef(value) {
  if (!isMutationRef(value)) throw new TypeError("invalid file mutation reference");
  return value;
}

function canonicalMutation(value) {
  assertFileMutationResult(value);
  return value.mutations[0];
}

function storedSnapshots(value, mutation) {
  const snapshots = value.snapshots;
  if (!isPlainObject(snapshots)) throw new TypeError("file mutation record requires snapshots");
  const state = snapshotStateOf(mutation);
  if ((state === MUTATION_SNAPSHOT_STATE.AVAILABLE) !== (typeof snapshots.after === "string")) {
    throw new TypeError("file mutation after snapshot does not match its metadata");
  }
  if ((mutation.diff === null) !== (snapshots.diff === null || snapshots.diff === undefined)) {
    throw new TypeError("file mutation diff snapshot does not match its metadata");
  }
  return { snapshots, state };
}

export function createFileMutationDiffPreview(value) {
  const mutation = canonicalMutation(value);
  const { snapshots } = storedSnapshots(value, mutation);
  return {
    ok: true,
    protocol: value.protocol,
    version: value.version,
    mutationId: mutation.id,
    locator: mutation.locator,
    diff: mutation.diff === null ? null : snapshots.diff,
  };
}

export function createFileMutationFilePreview(value) {
  const mutation = canonicalMutation(value);
  const { snapshots, state } = storedSnapshots(value, mutation);
  return {
    ok: true,
    protocol: value.protocol,
    version: value.version,
    mutationId: mutation.id,
    locator: mutation.locator,
    snapshot: state,
    isText: mutation.after.isText,
    size: mutation.after.size,
    content: state === MUTATION_SNAPSHOT_STATE.AVAILABLE ? snapshots.after : null,
  };
}

const DOWNLOAD_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DOWNLOAD_REVISION_PATTERN = /^[1-9][0-9]*$/;

function assertDownloadVersion({ revision, afterSha256 }) {
  if (
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    typeof afterSha256 !== "string" ||
    !DOWNLOAD_SHA256_PATTERN.test(afterSha256)
  ) {
    throw createFileMutationError(
      FILE_MUTATION_ERROR_CODE.INVALID_DOWNLOAD_REQUEST,
      "file mutation download requires a positive integer revision and a lowercase hex sha256",
    );
  }
}

export function decodeFileMutationDownloadRequest({ revision, afterSha256 } = {}) {
  const version = {
    revision:
      typeof revision === "string" && DOWNLOAD_REVISION_PATTERN.test(revision)
        ? Number(revision)
        : Number.NaN,
    afterSha256,
  };
  assertDownloadVersion(version);
  return Object.freeze(version);
}

export function createFileMutationDownload(value, { revision, afterSha256 } = {}) {
  assertDownloadVersion({ revision, afterSha256 });
  const mutation = canonicalMutation(value);
  const { snapshots, state } = storedSnapshots(value, mutation);
  if (revisionOf(mutation) !== revision) {
    throw createFileMutationError(
      FILE_MUTATION_ERROR_CODE.SNAPSHOT_OVERWRITTEN,
      `file mutation revision ${revision} was overwritten by revision ${revisionOf(mutation)}`,
    );
  }
  if (state === MUTATION_SNAPSHOT_STATE.DELETED) {
    throw createFileMutationError(
      FILE_MUTATION_ERROR_CODE.RESOURCE_DELETED,
      "file mutation deleted the file",
    );
  }
  if (state === MUTATION_SNAPSHOT_STATE.UNAVAILABLE) {
    throw createFileMutationError(
      FILE_MUTATION_ERROR_CODE.SNAPSHOT_UNAVAILABLE,
      "file mutation stored no after snapshot",
    );
  }
  if (mutation.after.sha256 !== afterSha256) {
    throw createFileMutationError(
      FILE_MUTATION_ERROR_CODE.SNAPSHOT_OVERWRITTEN,
      "file mutation after sha256 does not match the requested version",
    );
  }
  return Object.freeze({
    mutationId: mutation.id,
    fileName: mutation.fileName,
    sha256: mutation.after.sha256,
    content: snapshots.after,
  });
}
