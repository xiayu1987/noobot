/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isFunction } from "@noobot/shared/value";
export const PERSISTED_JSON_READ_ERROR_CODE = Object.freeze({
  MISSING: "PERSISTED_JSON_MISSING",
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

function createPersistedJsonMissingError(filePath, cause) {
  const error = new Error(`persisted JSON is missing: ${filePath}`, { cause });
  error.code = PERSISTED_JSON_READ_ERROR_CODE.MISSING;
  error.persistencePath = filePath;
  return error;
}

async function readParsedJson({ filePath, readFile }) {
  if (!isFunction(readFile)) {
    throw new TypeError("readPersistedJsonFile requires readFile");
  }
  if (typeof filePath !== "string" || !filePath) {
    throw new TypeError("readPersistedJsonFile requires filePath");
  }
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isMissingPersistencePathError(error))
      throw createPersistedJsonMissingError(filePath, error);
    throw createPersistedJsonReadError(filePath, error);
  }
}

export async function readPersistedJsonFile({ filePath, readFile }) {
  return readParsedJson({ filePath, readFile });
}

export async function readOptionalPersistedJsonFile({ filePath, readFile }) {
  try {
    return await readParsedJson({ filePath, readFile });
  } catch (error) {
    if (error.code === PERSISTED_JSON_READ_ERROR_CODE.MISSING) return null;
    throw error;
  }
}
