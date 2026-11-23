/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isFunction, isObjectLike } from "@noobot/shared/value";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import { createHash } from "node:crypto";

const immutableJsonSources = new WeakMap();
export const PERSISTED_JSON_READ_ERROR_CODE = Object.freeze({
  MISSING: "PERSISTED_JSON_MISSING",
  CORRUPTED: "PERSISTED_JSON_CORRUPTED",
  PERMISSION_DENIED: "PERSISTENCE_PERMISSION_DENIED",
  IO_FAILED: "PERSISTENCE_IO_FAILED",
});

export function isMissingPersistencePathError(error) {
  return error?.code === "ENOENT";
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

async function readParsedJson({ filePath, readFile, immutable = false, previousValue }) {
  if (!isFunction(readFile)) {
    throw new TypeError("readPersistedJsonFile requires readFile");
  }
  if (typeof filePath !== "string" || !filePath) {
    throw new TypeError("readPersistedJsonFile requires filePath");
  }
  try {
    const source = await readFile(filePath, "utf8");
    if (!immutable) return JSON.parse(source);
    const sourceHash = createHash("sha256").update(source).digest("hex");
    if (previousValue && immutableJsonSources.get(previousValue) === sourceHash)
      return previousValue;
    const value = deepFreeze(JSON.parse(source));
    if (isObjectLike(value)) immutableJsonSources.set(value, sourceHash);
    return value;
  } catch (error) {
    if (isMissingPersistencePathError(error))
      throw createPersistedJsonMissingError(filePath, error);
    throw createPersistedJsonReadError(filePath, error);
  }
}

export async function readPersistedJsonFile(options) {
  return readParsedJson(options);
}

export async function readOptionalPersistedJsonFile({ filePath, readFile }) {
  try {
    return await readParsedJson({ filePath, readFile });
  } catch (error) {
    if (error.code === PERSISTED_JSON_READ_ERROR_CODE.MISSING) return null;
    throw error;
  }
}
