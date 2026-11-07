/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { isTransientAtomicRenameError } from "./file-system.js";
import { isFunction } from "@noobot/shared/value";

export const ATOMIC_RENAME_RETRY_DELAYS_MS = Object.freeze([25, 75, 150, 300, 600]);
const TEMPORARY_FILE_PREFIX = ".noobot-atomic-";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function renameFileAtomic({
  source,
  filePath,
  rename,
  retryDelaysMs = ATOMIC_RENAME_RETRY_DELAYS_MS,
  platform = process.platform,
}) {
  if (!isFunction(rename)) throw new TypeError("atomic rename requires a rename operation");
  const delays = Array.isArray(retryDelaysMs) ? retryDelaysMs : ATOMIC_RENAME_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, filePath);
      return;
    } catch (error) {
      if (attempt >= delays.length || !isTransientAtomicRenameError(error, { platform }))
        throw error;
      await sleep(delays[attempt]);
    }
  }
}

export async function writeFileAtomic({
  filePath,
  content,
  encoding = "utf8",
  writeFile,
  rename,
  remove,
  retryDelaysMs = ATOMIC_RENAME_RETRY_DELAYS_MS,
  platform = process.platform,
} = {}) {
  if (!isFunction(writeFile) || !isFunction(rename) || !isFunction(remove)) {
    throw new TypeError("atomic file write requires writeFile, rename, and remove operations");
  }
  const temporary = path.join(path.dirname(filePath), `${TEMPORARY_FILE_PREFIX}${randomUUID()}`);
  try {
    await writeFile(temporary, content, encoding);
    await renameFileAtomic({ source: temporary, filePath, rename, retryDelaysMs, platform });
  } catch (error) {
    try {
      await remove(temporary, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "atomic write and temporary cleanup failed", {
        cause: error,
      });
    }
    throw error;
  }
}

export async function writeFileAtomicCreatingParents({ mkdir, ...options } = {}) {
  if (!isFunction(mkdir)) {
    throw new TypeError("atomic file write with parents requires a mkdir operation");
  }
  await mkdir(path.dirname(options.filePath), { recursive: true });
  await writeFileAtomic(options);
}
