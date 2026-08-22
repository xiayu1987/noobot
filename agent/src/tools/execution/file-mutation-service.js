/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFileDiff, createFileMutationResult } from "@noobot/file-mutation-protocol";

export const FILE_MUTATION_REPOSITORY_DIR = ".noobot/file-mutations";

export function resolveFileMutationRoot(workspaceRoot) {
  const root = String(workspaceRoot || "").trim();
  if (!root) throw new Error("workspace root is required");
  return path.join(root, FILE_MUTATION_REPOSITORY_DIR);
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
    if (error?.code === "ENOENT") return { exists: false, buffer: Buffer.alloc(0), content: "", isText: true };
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

export async function applyFileMutation({
  filePath,
  logicalPath,
  content = null,
  operation = "replace",
  mutationRoot,
  expectedSha256 = null,
  writeText = async (target, value) => writeFile(target, value, "utf8"),
  removeFile = async (target) => unlink(target),
} = {}) {
  const normalizedOperation = String(operation || "replace");
  if (!["create", "replace", "update", "delete"].includes(normalizedOperation))
    throw new TypeError(`unsupported file mutation operation: ${normalizedOperation}`);
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
  const diff = before.isText && (nextContent === null || afterIsText)
    ? createFileDiff(before.content || "", nextContent === null ? "" : nextContent)
    : null;
  const id = randomUUID();
  const result = createFileMutationResult({
    id,
    operation: before.exists ? normalizedOperation : "create",
    path: String(logicalPath || ""),
    fileName: path.basename(String(logicalPath || filePath)),
    before: {
      exists: before.exists,
      isText: before.isText,
      size: before.buffer.length,
      sha256: beforeSha256,
      snapshotRef: before.exists && before.isText ? { mutationId: id, section: "before" } : null,
    },
    after: {
      exists: nextContent !== null,
      isText: afterIsText,
      size: afterBuffer.length,
      sha256: nextContent === null ? null : digest(afterBuffer),
      snapshotRef: nextContent !== null && afterIsText ? { mutationId: id, section: "after" } : null,
    },
    diff: diff ? { ...diff, snapshotRef: { mutationId: id, section: "diff" } } : null,
  });
  const root = String(mutationRoot || "").trim();
  if (!root) throw new Error("file mutation repository root is required");
  await mkdir(root, { recursive: true });
  const recordPath = path.join(root, `${id}.json`);
  const temporaryRecordPath = `${recordPath}.${randomUUID()}.tmp`;
  const record = { ...result, snapshots: { before: before.content, after: nextContent, diff } };
  let targetCommitted = false;
  try {
    if (nextContent === null) await removeFile(filePath);
    else await writeText(filePath, nextContent);
    targetCommitted = true;
    await writeFile(temporaryRecordPath, JSON.stringify(record), "utf8");
    await rename(temporaryRecordPath, recordPath);
  } catch (error) {
    await rm(temporaryRecordPath, { force: true }).catch(() => {});
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

export async function readFileMutation({ mutationRoot, mutationId } = {}) {
  const id = String(mutationId || "").trim();
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    const error = new Error("invalid file mutation id");
    error.status = 400;
    throw error;
  }
  return JSON.parse(await readFile(path.join(String(mutationRoot), `${id}.json`), "utf8"));
}

export async function rollbackFileMutation({
  mutationRoot,
  mutationId,
  filePath,
  writeText = async (target, value) => writeFile(target, value, "utf8"),
  removeFile = async (target) => unlink(target),
} = {}) {
  const root = String(mutationRoot || "").trim();
  const record = await readFileMutation({ mutationRoot: root, mutationId });
  const before = record?.snapshots?.before;
  if (typeof before === "string") await writeText(filePath, before);
  else await removeFile(filePath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  await rm(path.join(root, `${String(mutationId).trim()}.json`), { force: true });
}
