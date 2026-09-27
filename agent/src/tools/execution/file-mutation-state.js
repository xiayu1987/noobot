/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import os from "node:os";
import { filePath as path } from "@noobot/path-resolver";
import { FileMutationCoordinator } from "../../shared/storage/file-mutation-coordinator.js";

const coordinator = new FileMutationCoordinator({
  timeoutMessage: "file mutation lock timeout",
  timeoutErrorCode: "FILE_MUTATION_BUSY",
  operationName: "fileMutation.refreshLock",
});

export function fileContentSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function assertFileMutationVersion(filePath, expectedSha256) {
  const actualSha256 = await readFile(filePath)
    .then(fileContentSha256)
    .catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
  if (actualSha256 === expectedSha256) return;
  const error = new Error(
    `file changed since it was loaded: ${filePath}; read the file again and rebuild the patch`,
  );
  error.code = "file_mutation_conflict";
  error.status = 409;
  error.details = { filePath, expectedSha256, actualSha256 };
  throw error;
}

async function canonicalFilePath(filePath) {
  const resolved = path.resolve(filePath);
  try {
    return await realpath(resolved);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const parent = path.dirname(resolved);
    if (parent === resolved) throw error;
    return path.join(await canonicalFilePath(parent), path.basename(resolved));
  }
}

export async function withFileMutationLocks(filePaths, operation) {
  const identities = await Promise.all(filePaths.map(canonicalFilePath));
  const lockRoot = path.join(
    os.tmpdir(),
    `noobot-file-mutation-locks-${process.getuid?.() ?? "user"}`,
  );
  const locks = [...new Set(identities)].sort();
  const run = (index) =>
    index === locks.length
      ? operation()
      : coordinator.run(path.join(lockRoot, `${fileContentSha256(locks[index])}.lock`), () =>
          run(index + 1),
        );
  return run(0);
}
