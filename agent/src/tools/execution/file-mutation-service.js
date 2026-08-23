/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import {
  assertFileMutationResult,
  createFileDiff,
  createFileMutationResult,
} from "@noobot/file-mutation-protocol";
import { FileMutationCoordinator } from "../../shared/storage/file-mutation-coordinator.js";
import { resolveSessionGeneratedDataRoot } from "../../session/session-generated-data.js";

const fileMutationCoordinator = new FileMutationCoordinator({
  timeoutMessage: "file mutation lock timeout",
  timeoutErrorCode: "FILE_MUTATION_BUSY",
  operationName: "fileMutation.refreshLock",
});

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
  const normalized = String(scopeId || "").trim();
  if (operation === "update" && !normalized) {
    throw new TypeError("file mutation scope is required for update");
  }
  return normalized;
}

function aggregateMutationId(scopeId, logicalPath) {
  const digestValue = digest(`noobot.file-mutation:${scopeId}\u0000${logicalPath}`);
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
    if (error?.code === "ENOENT") return null;
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

async function applyFileMutationInternal({
  filePath,
  logicalPath,
  content = null,
  operation = "replace",
  scopeId = "",
  mutationRoot,
  expectedSha256 = null,
  rollbackState = null,
  sessionScope = null,
  writeText = async (target, value) => writeFile(target, value, "utf8"),
  removeFile = async (target) => unlink(target),
} = {}) {
  const normalizedOperation = String(operation || "replace");
  if (!["create", "replace", "update", "delete"].includes(normalizedOperation))
    throw new TypeError(`unsupported file mutation operation: ${normalizedOperation}`);
  const normalizedScopeId = normalizeMutationScope(scopeId, normalizedOperation);
  const normalizedLogicalPath = String(logicalPath || "").trim();
  if (!normalizedLogicalPath) throw new TypeError("file mutation logical path is required");
  const root = String(mutationRoot || "").trim();
  if (!root) throw new Error("file mutation repository root is required");
  const before = await readExisting(filePath);
  const beforeSha256 = before.exists ? digest(before.buffer) : null;
  if (expectedSha256 !== null && beforeSha256 !== expectedSha256) {
    const error = new Error("file changed since it was loaded");
    error.code = "file_mutation_conflict";
    error.status = 409;
    throw error;
  }
  if (normalizedOperation === "create" && before.exists) {
    const error = new Error("target file already exists");
    error.code = "file_mutation_already_exists";
    error.status = 409;
    throw error;
  }
  if (normalizedOperation === "delete" && !before.exists) {
    const error = new Error("target file does not exist");
    error.code = "file_mutation_not_found";
    error.status = 404;
    throw error;
  }

  const nextContent = content === null ? null : String(content);
  const afterBuffer = nextContent === null ? Buffer.alloc(0) : Buffer.from(nextContent, "utf8");
  const afterIsText = nextContent !== null && !afterBuffer.includes(0);
  const incrementalDiff =
    before.isText && (nextContent === null || afterIsText)
      ? createFileDiff(before.content || "", nextContent === null ? "" : nextContent)
      : null;
  const isAggregate = normalizedOperation === "update";
  const id = isAggregate
    ? aggregateMutationId(normalizedScopeId, normalizedLogicalPath)
    : randomUUID();
  const existingRecord = isAggregate ? await readOptionalRecord(root, id) : null;
  if (rollbackState && typeof rollbackState === "object") {
    rollbackState.before = before;
    rollbackState.record = existingRecord;
  }
  const existingMutation = existingRecord?.mutations?.[0] || null;
  if (existingMutation) {
    if (
      existingMutation.path !== normalizedLogicalPath ||
      existingMutation.aggregate?.scopeId !== normalizedScopeId
    ) {
      throw new Error("file mutation aggregate identity conflict");
    }
    if (existingMutation.after?.sha256 !== beforeSha256) {
      const error = new Error("file changed outside the active mutation aggregate");
      error.code = "file_mutation_aggregate_conflict";
      error.status = 409;
      throw error;
    }
  }
  const initialBeforeContent = existingRecord ? existingRecord.snapshots?.before : before.content;
  const aggregateDiff =
    isAggregate && typeof initialBeforeContent === "string" && (nextContent === null || afterIsText)
      ? createFileDiff(initialBeforeContent, nextContent === null ? "" : nextContent)
      : incrementalDiff;
  const previousDiffs = Array.isArray(existingRecord?.snapshots?.diffs)
    ? existingRecord.snapshots.diffs
    : [];
  const revision = previousDiffs.length + 1;
  const incrementalDiffEntry = incrementalDiff
    ? { revision, ...incrementalDiff }
    : { revision, diff: null };
  const diffs = isAggregate ? [...previousDiffs, incrementalDiffEntry] : undefined;
  const beforeMeta = existingMutation?.before || {
    exists: before.exists,
    isText: before.isText,
    size: before.buffer.length,
    sha256: beforeSha256,
    snapshotRef: before.exists && before.isText ? { mutationId: id, section: "before" } : null,
  };
  const afterMeta = {
    exists: nextContent !== null,
    isText: afterIsText,
    size: afterBuffer.length,
    sha256: nextContent === null ? null : digest(afterBuffer),
    snapshotRef: nextContent !== null && afterIsText ? { mutationId: id, section: "after" } : null,
  };
  const aggregate = isAggregate
    ? {
        scopeId: normalizedScopeId,
        path: normalizedLogicalPath,
        revision,
        diffCount: diffs.length,
      }
    : null;
  const result = createFileMutationResult({
    id,
    operation: before.exists ? normalizedOperation : "create",
    path: normalizedLogicalPath,
    fileName: path.basename(normalizedLogicalPath || filePath),
    before: beforeMeta,
    after: afterMeta,
    diff: aggregateDiff
      ? { ...aggregateDiff, snapshotRef: { mutationId: id, section: "diff" } }
      : null,
    aggregate,
    sessionScope,
  });
  await mkdir(root, { recursive: true });
  const recordPath = path.join(root, `${id}.json`);
  const temporaryRecordPath = `${recordPath}.${randomUUID()}.tmp`;
  const record = {
    ...result,
    snapshots: {
      before: initialBeforeContent,
      after: nextContent,
      diff: aggregateDiff,
      ...(isAggregate ? { diffs } : {}),
    },
  };
  let targetCommitted = false;
  try {
    if (nextContent === null) await removeFile(filePath);
    else await writeText(filePath, nextContent);
    targetCommitted = true;
    await writeFile(temporaryRecordPath, JSON.stringify(record), "utf8");
    await rename(temporaryRecordPath, recordPath);
  } catch (error) {
    await rm(temporaryRecordPath, { force: true }).catch((cleanupError) => {
      void cleanupError;
    });
    if (targetCommitted) {
      try {
        await restoreTarget(filePath, before, { writeText, removeFile });
      } catch (rollbackError) {
        error.code = "file_mutation_commit_and_rollback_failed";
        error.rollbackError = rollbackError;
        throw error;
      }
    }
    error.code = error.code || "file_mutation_commit_failed";
    throw error;
  }
  return result;
}

export async function applyFileMutation(options = {}) {
  const root = String(options?.mutationRoot || "").trim();
  const logicalPath = String(options?.logicalPath || "").trim();
  const scopeId = String(options?.scopeId || "").trim();
  if (!root || !logicalPath) return applyFileMutationInternal(options);
  const lockIdentity = `${scopeId}\u0000${logicalPath}`;
  const lockPath = path.join(`${root}.locks`, `${digest(lockIdentity)}.lock`);
  return fileMutationCoordinator.run(lockPath, () => applyFileMutationInternal(options));
}

export async function readFileMutation({ mutationRoot, mutationId } = {}) {
  const id = String(mutationId || "").trim();
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    const error = new Error("invalid file mutation id");
    error.status = 400;
    throw error;
  }
  return assertFileMutationResult(
    JSON.parse(await readFile(path.join(String(mutationRoot), `${id}.json`), "utf8")),
  );
}

export async function rollbackFileMutation({
  mutationRoot,
  mutationId,
  filePath,
  restoreState = null,
  writeText = async (target, value) => writeFile(target, value, "utf8"),
  removeFile = async (target) => unlink(target),
} = {}) {
  const root = String(mutationRoot || "").trim();
  const record = await readFileMutation({ mutationRoot: root, mutationId });
  if (restoreState && typeof restoreState === "object" && restoreState.before) {
    await restoreTarget(filePath, restoreState.before, { writeText, removeFile });
    const recordPath = path.join(root, `${String(mutationId).trim()}.json`);
    if (restoreState.record) {
      const temporaryRecordPath = `${recordPath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryRecordPath, JSON.stringify(restoreState.record), "utf8");
        await rename(temporaryRecordPath, recordPath);
      } finally {
        await rm(temporaryRecordPath, { force: true }).catch((cleanupError) => {
          void cleanupError;
        });
      }
    } else {
      await rm(recordPath, { force: true });
    }
    return;
  }
  const before = record?.snapshots?.before;
  const beforeMeta = record?.mutations?.[0]?.before;
  if (beforeMeta?.exists === true && typeof before === "string") await writeText(filePath, before);
  else
    await removeFile(filePath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  await rm(path.join(root, `${String(mutationId).trim()}.json`), { force: true });
}
