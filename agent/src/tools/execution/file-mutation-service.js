/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import {
  FILE_MUTATION_ERROR_CODE,
  assertFileMutationResult,
  createFileDiff,
  createFileMutationDownload,
  createFileMutationError,
  createFileMutationLocator,
  createFileMutationResult,
} from "@noobot/file-mutation-protocol";
import {
  assertFileMutationVersion,
  fileContentSha256,
  withFileMutationLocks,
} from "./file-mutation-state.js";
import { resolveSessionGeneratedDataRoot } from "../../session/session-generated-data.js";
import { text, isFunction } from "@noobot/shared/value";

export function resolveFileMutationRoot(sessionDir) {
  return resolveSessionGeneratedDataRoot(sessionDir, "fileMutations");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readExisting(filePath) {
  try {
    const buffer = await readFile(filePath);
    const isText = !buffer.includes(0);
    return { exists: true, buffer, content: isText ? buffer.toString("utf8") : null, isText };
  } catch (error) {
    if (error?.code === "ENOENT")
      return { exists: false, buffer: Buffer.alloc(0), content: "", isText: true };
    throw error;
  }
}

function normalizeMutationScope(scopeId, operation) {
  const normalized = text(scopeId);
  if (operation === "update" && !normalized) {
    throw new TypeError("file mutation scope is required for update");
  }
  return normalized;
}

function aggregateMutationId(scopeId, locator) {
  const digestValue = digest(
    `noobot.file-mutation:${scopeId}\u0000${locator.view}\u0000${locator.path}`,
  );
  return [
    digestValue.slice(0, 8),
    digestValue.slice(8, 12),
    `4${digestValue.slice(13, 16)}`,
    `${((Number.parseInt(digestValue.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0")}${digestValue.slice(18, 20)}`,
    digestValue.slice(20, 32),
  ].join("-");
}

async function readOptionalRecord(mutationRoot, mutationId) {
  try {
    return await readFileMutation({ mutationRoot, mutationId });
  } catch (error) {
    if (error?.code === FILE_MUTATION_ERROR_CODE.RECORD_NOT_FOUND) return null;
    throw error;
  }
}

async function restoreTarget(filePath, before, { writeText, removeFile }) {
  if (before.exists) {
    if (before.isText) await writeText(filePath, before.content);
    else await writeFile(filePath, before.buffer);
  } else {
    await removeFile(filePath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

function collectExternalChanges(existingRecord, before, beforeSha256) {
  const changes = [...(existingRecord?.snapshots?.externalChanges || [])];
  const mutation = existingRecord?.mutations?.[0];
  if (mutation && mutation.after?.sha256 !== beforeSha256) {
    changes.push({
      beforeRevision: mutation.aggregate.revision + 1,
      beforeSha256: mutation.after?.sha256,
      afterSha256: beforeSha256,
      before: existingRecord.snapshots?.after,
      after: before.content,
    });
  }
  return changes;
}

function assertMutationPreconditions({ before, beforeSha256, expectedSha256, operation, locator }) {
  if (expectedSha256 !== undefined && beforeSha256 !== expectedSha256) {
    throw createFileMutationError(
      FILE_MUTATION_ERROR_CODE.CONFLICT,
      `file changed since it was loaded: ${locator.path}; read the file again and rebuild the patch`,
      { details: { filePath: locator.path, expectedSha256, actualSha256: beforeSha256 } },
    );
  }
  if (operation === "create" && before.exists) {
    throw createFileMutationError(
      FILE_MUTATION_ERROR_CODE.ALREADY_EXISTS,
      "target file already exists",
    );
  }
  if (operation === "delete" && !before.exists) {
    throw createFileMutationError(
      FILE_MUTATION_ERROR_CODE.TARGET_NOT_FOUND,
      "target file does not exist",
    );
  }
}

const FILE_MUTATION_OPERATIONS = Object.freeze(["create", "replace", "update", "delete"]);

function isRollbackState(rollbackState) {
  return Boolean(rollbackState) && typeof rollbackState === "object";
}

function normalizeMutationRequest({ locator, operation, scopeId, mutationRoot, writeText }) {
  const normalizedOperation = String(operation || "replace");
  if (!FILE_MUTATION_OPERATIONS.includes(normalizedOperation))
    throw new TypeError(`unsupported file mutation operation: ${normalizedOperation}`);
  const normalizedScopeId = normalizeMutationScope(scopeId, normalizedOperation);
  const normalizedLocator = createFileMutationLocator(locator);
  const root = text(mutationRoot);
  if (!root) throw new Error("file mutation repository root is required");
  if (!isFunction(writeText)) {
    throw new TypeError("file mutation write capability is required");
  }
  return {
    operation: normalizedOperation,
    scopeId: normalizedScopeId,
    locator: normalizedLocator,
    root,
    isAggregate: normalizedOperation === "update",
  };
}

function describeNextContent(content, before) {
  const nextContent = content === null ? null : String(content);
  const afterBuffer = nextContent === null ? Buffer.alloc(0) : Buffer.from(nextContent, "utf8");
  const afterIsText = nextContent !== null && !afterBuffer.includes(0);
  const diffable = nextContent === null || afterIsText;
  const diffTarget = nextContent === null ? "" : nextContent;
  const incrementalDiff =
    before.isText && diffable ? createFileDiff(before.content || "", diffTarget) : null;
  return { nextContent, afterBuffer, afterIsText, diffable, diffTarget, incrementalDiff };
}

function assertAggregateIdentity(existingMutation, request) {
  if (!existingMutation) return;
  if (
    existingMutation.locator.view !== request.locator.view ||
    existingMutation.locator.path !== request.locator.path ||
    existingMutation.aggregate?.scopeId !== request.scopeId
  ) {
    throw new Error("file mutation aggregate identity conflict");
  }
}

function buildAggregateHistory({ request, existingRecord, before, beforeSha256, next }) {
  const externalChanges = collectExternalChanges(existingRecord, before, beforeSha256);
  const initialBeforeContent = existingRecord ? existingRecord.snapshots?.before : before.content;
  const aggregateDiff =
    request.isAggregate && typeof initialBeforeContent === "string" && next.diffable
      ? createFileDiff(initialBeforeContent, next.diffTarget)
      : next.incrementalDiff;
  const previousDiffs = Array.isArray(existingRecord?.snapshots?.diffs)
    ? existingRecord.snapshots.diffs
    : [];
  const revision = previousDiffs.length + 1;
  const incrementalDiffEntry = next.incrementalDiff
    ? { revision, ...next.incrementalDiff }
    : { revision, diff: null };
  const diffs = request.isAggregate ? [...previousDiffs, incrementalDiffEntry] : undefined;
  return { externalChanges, initialBeforeContent, aggregateDiff, revision, diffs };
}

function buildBeforeMeta({ existingMutation, before, beforeSha256, id }) {
  return (
    existingMutation?.before || {
      exists: before.exists,
      isText: before.isText,
      size: before.buffer.length,
      sha256: beforeSha256,
      snapshotRef: before.exists && before.isText ? { mutationId: id, section: "before" } : null,
    }
  );
}

function buildAfterMeta(next, id) {
  const exists = next.nextContent !== null;
  return {
    exists,
    isText: next.afterIsText,
    size: next.afterBuffer.length,
    sha256: exists ? digest(next.afterBuffer) : null,
    snapshotRef: exists && next.afterIsText ? { mutationId: id, section: "after" } : null,
  };
}

function buildAggregateMeta(request, history) {
  if (!request.isAggregate) return null;
  return {
    scopeId: request.scopeId,
    revision: history.revision,
    diffCount: history.diffs.length,
    ...(history.externalChanges.length
      ? { externalChangeCount: history.externalChanges.length }
      : {}),
  };
}

async function commitMutationRecord({
  root,
  id,
  record,
  filePath,
  before,
  beforeSha256,
  afterMeta,
  nextContent,
  rollbackState,
  writeText,
  removeFile,
}) {
  await mkdir(root, { recursive: true });
  const recordPath = path.join(root, `${id}.json`);
  const temporaryRecordPath = `${recordPath}.${randomUUID()}.tmp`;
  await assertFileMutationVersion(filePath, beforeSha256);
  let targetCommitted = false;
  try {
    if (nextContent === null) await removeFile(filePath);
    else await writeText(filePath, nextContent);
    targetCommitted = true;
    await writeFile(temporaryRecordPath, JSON.stringify(record), "utf8");
    await rename(temporaryRecordPath, recordPath);
    if (isRollbackState(rollbackState)) rollbackState.committedRecord = record;
  } catch (error) {
    await rm(temporaryRecordPath, { force: true }).catch((cleanupError) => {
      void cleanupError;
    });
    if (targetCommitted) {
      try {
        await assertFileMutationVersion(filePath, afterMeta.sha256);
        await restoreTarget(filePath, before, { writeText, removeFile });
      } catch (rollbackError) {
        throw createFileMutationError(
          FILE_MUTATION_ERROR_CODE.COMMIT_AND_ROLLBACK_FAILED,
          `file mutation commit failed and the target could not be restored: ${error.message}`,
          { cause: error, details: { rollbackError: rollbackError.message } },
        );
      }
    }
    throw createFileMutationError(
      FILE_MUTATION_ERROR_CODE.COMMIT_FAILED,
      `file mutation commit failed: ${error.message}`,
      { cause: error },
    );
  }
}

async function applyFileMutationInternal({
  filePath,
  locator,
  content = null,
  operation = "replace",
  scopeId = "",
  mutationRoot,
  expectedSha256 = undefined,
  rollbackState = null,
  sessionScope,
  writeText,
  removeFile = async (target) => unlink(target),
} = {}) {
  const request = normalizeMutationRequest({
    locator,
    operation,
    scopeId,
    mutationRoot,
    writeText,
  });
  const before = await readExisting(filePath);
  const beforeSha256 = before.exists ? digest(before.buffer) : null;
  assertMutationPreconditions({
    before,
    beforeSha256,
    expectedSha256,
    operation: request.operation,
    locator: request.locator,
  });
  const next = describeNextContent(content, before);
  const id = request.isAggregate
    ? aggregateMutationId(request.scopeId, request.locator)
    : randomUUID();
  const existingRecord = request.isAggregate ? await readOptionalRecord(request.root, id) : null;
  if (isRollbackState(rollbackState)) {
    rollbackState.before = before;
    rollbackState.record = existingRecord;
  }
  const existingMutation = existingRecord?.mutations?.[0] || null;
  assertAggregateIdentity(existingMutation, request);
  const history = buildAggregateHistory({ request, existingRecord, before, beforeSha256, next });
  const afterMeta = buildAfterMeta(next, id);
  const result = createFileMutationResult({
    id,
    operation: before.exists ? request.operation : "create",
    locator: request.locator,
    fileName: path.basename(request.locator.path),
    before: buildBeforeMeta({ existingMutation, before, beforeSha256, id }),
    after: afterMeta,
    diff: history.aggregateDiff
      ? { ...history.aggregateDiff, snapshotRef: { mutationId: id, section: "diff" } }
      : null,
    aggregate: buildAggregateMeta(request, history),
    sessionScope,
  });
  const record = {
    ...result,
    snapshots: {
      before: history.initialBeforeContent,
      after: next.nextContent,
      diff: history.aggregateDiff,
      ...(request.isAggregate
        ? { diffs: history.diffs, externalChanges: history.externalChanges }
        : {}),
    },
  };
  await commitMutationRecord({
    root: request.root,
    id,
    record,
    filePath,
    before,
    beforeSha256,
    afterMeta,
    nextContent: next.nextContent,
    rollbackState,
    writeText,
    removeFile,
  });
  return result;
}

export async function applyFileMutation(options = {}) {
  if (!options.filePath) return applyFileMutationInternal(options);
  return withFileMutationLocks([options.filePath], () => applyFileMutationInternal(options));
}

export async function readFileMutation({ mutationRoot, mutationId } = {}) {
  const id = text(mutationId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw createFileMutationError(FILE_MUTATION_ERROR_CODE.INVALID_ID, "invalid file mutation id");
  }
  let serialized;
  try {
    serialized = await readFile(path.join(String(mutationRoot), `${id}.json`), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    throw createFileMutationError(
      FILE_MUTATION_ERROR_CODE.RECORD_NOT_FOUND,
      `file mutation record not found: ${id}`,
      { cause: error },
    );
  }
  return assertFileMutationResult(JSON.parse(serialized));
}

export async function readFileMutationDownload({
  mutationRoot,
  mutationId,
  revision,
  afterSha256,
} = {}) {
  const record = await readFileMutation({ mutationRoot, mutationId });
  const download = createFileMutationDownload(record, { revision, afterSha256 });
  const content = Buffer.from(download.content, "utf8");
  if (fileContentSha256(content) !== download.sha256) {
    throw createFileMutationError(
      FILE_MUTATION_ERROR_CODE.SNAPSHOT_CORRUPT,
      `file mutation snapshot does not match its sha256: ${download.mutationId}`,
    );
  }
  return Object.freeze({ ...download, content });
}

async function rollbackFileMutationInternal({
  mutationRoot,
  mutationId,
  filePath,
  restoreState,
  writeText = async (target, value) => writeFile(target, value, "utf8"),
  removeFile = async (target) => unlink(target),
} = {}) {
  if (!isRollbackState(restoreState) || !restoreState.before || !restoreState.committedRecord) {
    throw new TypeError("file mutation rollback requires the committed rollback state");
  }
  const root = text(mutationRoot);
  const record = await readFileMutation({ mutationRoot: root, mutationId });
  if (JSON.stringify(record) !== JSON.stringify(restoreState.committedRecord)) {
    throw createFileMutationError(
      FILE_MUTATION_ERROR_CODE.CONFLICT,
      "file mutation record changed before rollback",
    );
  }
  await assertFileMutationVersion(filePath, record.mutations[0].after.sha256);
  await restoreTarget(filePath, restoreState.before, { writeText, removeFile });
  const recordPath = path.join(root, `${text(mutationId)}.json`);
  if (!restoreState.record) {
    await rm(recordPath, { force: true });
    return;
  }
  const temporaryRecordPath = `${recordPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryRecordPath, JSON.stringify(restoreState.record), "utf8");
    await rename(temporaryRecordPath, recordPath);
  } finally {
    await rm(temporaryRecordPath, { force: true }).catch((cleanupError) => {
      void cleanupError;
    });
  }
}

export async function rollbackFileMutation(options = {}) {
  return withFileMutationLocks([options.filePath], () => rollbackFileMutationInternal(options));
}
