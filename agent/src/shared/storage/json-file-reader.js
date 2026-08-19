/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const PERSISTED_JSON_READ_ERROR_CODE = Object.freeze({
  CORRUPTED: "PERSISTED_JSON_CORRUPTED",
  PERMISSION_DENIED: "PERSISTENCE_PERMISSION_DENIED",
  IO_FAILED: "PERSISTENCE_IO_FAILED",
});

export function isMissingPersistencePathError(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

function createPersistedJsonReadError(filePath, cause) {
  const corrupted = cause instanceof SyntaxError;
  const permissionDenied = cause?.code === "EACCES" || cause?.code === "EPERM";
  const error = new Error(
    corrupted
      ? `persisted JSON is corrupted: ${filePath}`
      : `persisted JSON cannot be read: ${filePath}`,
    { cause },
  );
  error.code = corrupted
    ? PERSISTED_JSON_READ_ERROR_CODE.CORRUPTED
    : permissionDenied
      ? PERSISTED_JSON_READ_ERROR_CODE.PERMISSION_DENIED
      : PERSISTED_JSON_READ_ERROR_CODE.IO_FAILED;
  error.persistencePath = filePath;
  return error;
}

export async function readPersistedJsonFile({ filePath = "", fallback = null, readFile } = {}) {
  if (typeof readFile !== "function") {
    throw new TypeError("readPersistedJsonFile requires readFile");
  }
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (isMissingPersistencePathError(error)) return fallback;
    throw createPersistedJsonReadError(filePath, error);
  }
}
