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
  describeFileMutationFailure,
  createFileMutationLocator,
  createFileMutationResult,
  assertFileText,
  decodePatchText,
  assertFileTextEncoding,
  resolveFileWriteEncoding,
} from "@noobot/file-mutation-protocol";
import { decodeFileDocument, encodeFileText } from "@noobot/file-mutation-protocol/text-codec-node";
import {
  assertFileMutationVersion,
  fileContentSha256,
  withFileMutationLocks,
} from "./file-mutation-state.js";
import { resolveSessionGeneratedDataRoot } from "../../session/session-generated-data.js";
import { text, isFunction } from "@noobot/shared/value";
import { renameFileAtomic, writeFileAtomic } from "../../shared/storage/atomic-file-write.js";

export function resolveFileMutationRoot(sessionDir) {
  return resolveSessionGeneratedDataRoot(sessionDir, "fileMutations");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readExisting(filePath, encoding) {
  try {
    const buffer = await readFile(filePath);
    const document = decodeFileDocument(buffer, encoding);
    const { textFormat } = decodePatchText(document.content, document.encoding);
    return { exists: true, buffer, content: document.content, isText: true, textFormat };
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

async function restoreTarget(filePath, before) {
  if (before.exists) {
    await writeFileAtomic({ filePath, content: before.buffer, writeFile, rename, remove: rm });
  } else {
    await unlink(filePath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  await assertFileMutationVersion(filePath, before.exists ? digest(before.buffer) : null);
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

function normalizeMutationRequest({ locator, operation, scopeId, mutationRoot, stageBytes }) {
  const normalizedOperation = String(operation || "replace");
  if (!FILE_MUTATION_OPERATIONS.includes(normalizedOperation))
    throw new TypeError(`unsupported file mutation operation: ${normalizedOperation}`);
  const normalizedScopeId = normalizeMutationScope(scopeId, normalizedOperation);
  const normalizedLocator = createFileMutationLocator(locator);
  const root = text(mutationRoot);
  if (!root) throw new Error("file mutation repository root is required");
  if (!isFunction(stageBytes)) {
    throw new TypeError("file mutation staging capability is required");
  }
  return {
    operation: normalizedOperation,
    scopeId: normalizedScopeId,
    locator: normalizedLocator,
    root,
    isAggregate: normalizedOperation === "update",
  };
}

function describeNextContent(content, before, encoding) {
  const nextContent = content === null ? null : assertFileText(content);
  const resolvedEncoding = resolveFileWriteEncoding(
    encoding,
    before.exists ? before.textFormat.encoding : null,
  );
  const afterBuffer =
    nextContent === null ? Buffer.alloc(0) : encodeFileText(nextContent, resolvedEncoding);
  const afterIsText = nextContent !== null;
  const textFormat = afterIsText ? decodePatchText(nextContent, resolvedEncoding).textFormat : null;
  const diffTarget = nextContent === null ? "" : nextContent;
  const incrementalDiff = createFileDiff(before.content, diffTarget);
  return {
    nextContent,
    afterBuffer,
    afterIsText,
    textFormat,
    diffTarget,
    incrementalDiff,
  };
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
    request.isAggregate && typeof initialBeforeContent === "string"
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
      textFormat: before.textFormat,
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
    textFormat: next.textFormat,
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

async function cleanupMutationFiles(paths) {
  const results = await Promise.allSettled(paths.map((filePath) => rm(filePath, { force: true })));
  return results.flatMap((result, index) =>
    result.status === "rejected"
      ? [{ path: paths[index], error: result.reason.message, code: result.reason.code }]
      : [],
  );
}

async function restoreFailedCommit({ filePath, before, afterMeta, targetCommitted }) {
  if (!targetCommitted) return "not_committed";
  await assertFileMutationVersion(filePath, afterMeta.sha256);
  await restoreTarget(filePath, before);
  return "restored";
}

async function commitMutationRecord({
  root,
  id,
  record,
  filePath,
  before,
  beforeSha256,
  afterMeta,
  next,
  rollbackState,
  stageBytes,
}) {
  await mkdir(root, { recursive: true });
  const recordPath = path.join(root, `${id}.json`);
  const temporaryRecordPath = `${recordPath}.${randomUUID()}.tmp`;
  const stagedPath = path.join(path.dirname(filePath), `.noobot-mutation-${randomUUID()}`);
  await assertFileMutationVersion(filePath, beforeSha256);
  let targetCommitted = false;
  try {
    if (next.nextContent !== null) {
      await stageBytes(stagedPath, next.afterBuffer);
      await assertFileMutationVersion(stagedPath, afterMeta.sha256);
    }
    await assertFileMutationVersion(filePath, beforeSha256);
    if (next.nextContent === null) await unlink(filePath);
    else await renameFileAtomic({ source: stagedPath, filePath, rename });
    targetCommitted = true;
    await assertFileMutationVersion(filePath, afterMeta.sha256);
    await writeFile(temporaryRecordPath, JSON.stringify(record), "utf8");
    await rename(temporaryRecordPath, recordPath);
    if (isRollbackState(rollbackState)) rollbackState.committedRecord = record;
  } catch (error) {
    const cleanupErrors = await cleanupMutationFiles([temporaryRecordPath, stagedPath]);
    let targetState;
    try {
      targetState = await restoreFailedCommit({ filePath, before, afterMeta, targetCommitted });
    } catch (rollbackError) {
      throw createFileMutationError(
        FILE_MUTATION_ERROR_CODE.COMMIT_AND_ROLLBACK_FAILED,
        `file mutation commit failed and the target could not be restored: ${error.message}`,
        {
          cause: error,
          details: {
            targetState:
              rollbackError.code === FILE_MUTATION_ERROR_CODE.CONFLICT
                ? "conflict"
                : "restore_failed",
            rollbackError: describeFileMutationFailure(rollbackError),
            cleanupErrors,
          },
        },
      );
    }
    throw createFileMutationError(
      FILE_MUTATION_ERROR_CODE.COMMIT_FAILED,
      `file mutation commit failed: ${error.message}`,
      { cause: error, details: { targetState, cleanupErrors } },
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
  stageBytes,
  encoding = "auto",
} = {}) {
  assertFileTextEncoding(encoding);
  const request = normalizeMutationRequest({
    locator,
    operation,
    scopeId,
    mutationRoot,
    stageBytes,
  });
  const before = await readExisting(filePath, encoding);
  const beforeSha256 = before.exists ? digest(before.buffer) : null;
  assertMutationPreconditions({
    before,
    beforeSha256,
    expectedSha256,
    operation: request.operation,
    locator: request.locator,
  });
  const next = describeNextContent(content, before, encoding);
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
    next,
    rollbackState,
    stageBytes,
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
  const content = encodeFileText(download.content, download.textFormat?.encoding);
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
  await restoreTarget(filePath, restoreState.before);
  const recordPath = path.join(root, `${text(mutationId)}.json`);
  if (!restoreState.record) {
    const cleanupErrors = await cleanupMutationFiles([recordPath]);
    if (cleanupErrors.length) {
      throw createFileMutationError(
        FILE_MUTATION_ERROR_CODE.CLEANUP_FAILED,
        "file bytes restored but mutation record cleanup failed",
        { details: { targetState: "restored", cleanupErrors } },
      );
    }
    return;
  }
  const temporaryRecordPath = `${recordPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryRecordPath, JSON.stringify(restoreState.record), "utf8");
    await rename(temporaryRecordPath, recordPath);
  } catch (error) {
    const cleanupErrors = await cleanupMutationFiles([temporaryRecordPath]);
    throw createFileMutationError(
      FILE_MUTATION_ERROR_CODE.ROLLBACK_CONFLICT,
      `file bytes restored but mutation record restoration failed: ${error.message}`,
      { cause: error, details: { targetState: "restored", cleanupErrors } },
    );
  }
}

export async function rollbackFileMutation(options = {}) {
  return withFileMutationLocks([options.filePath], () => rollbackFileMutationInternal(options));
}
