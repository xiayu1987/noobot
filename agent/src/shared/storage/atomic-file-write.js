/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { filePath as path } from "@noobot/path-resolver";

export const ATOMIC_RENAME_RETRY_DELAYS_MS = Object.freeze([25, 75, 150, 300, 600]);

const ATOMIC_RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableAtomicRenameError(error) {
  return ATOMIC_RENAME_RETRY_CODES.has(String(error?.code || ""));
}

export async function writeFileAtomic({
  filePath,
  content,
  encoding = "utf8",
  writeFile,
  rename,
  remove,
  retryDelaysMs = ATOMIC_RENAME_RETRY_DELAYS_MS,
} = {}) {
  if (
    typeof writeFile !== "function" ||
    typeof rename !== "function" ||
    typeof remove !== "function"
  ) {
    throw new TypeError("atomic file write requires writeFile, rename, and remove operations");
  }
  const delays = Array.isArray(retryDelaysMs) ? retryDelaysMs : ATOMIC_RENAME_RETRY_DELAYS_MS;
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.noobot-${process.pid}-${Date.now()}-${randomUUID()}`,
  );
  try {
    await writeFile(temporary, content, encoding);
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temporary, filePath);
        return;
      } catch (error) {
        if (attempt >= delays.length || !isRetryableAtomicRenameError(error)) throw error;
        await sleep(delays[attempt]);
      }
    }
  } catch (error) {
    await remove(temporary, { force: true }).catch(() => {});
    throw error;
  }
}
