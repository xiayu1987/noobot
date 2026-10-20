/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeSessionTree } from "./session-tree.js";
import { requireSessionTombstoneSessions } from "./session-tombstone.js";

export const SESSION_STORE_ERROR = Object.freeze({
  WORKSPACE_NOT_INITIALIZED: "WORKSPACE_NOT_INITIALIZED",
  CORRUPTED: "SESSION_STORE_FILE_CORRUPTED",
});

function sessionStoreError(code, message, details, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.details = details;
  return error;
}

function requireStoreFile(file) {
  if (typeof file !== "string" || !file.trim()) {
    throw new TypeError("session store requires file");
  }
  return file;
}

function requireRawOrMissing(raw) {
  if (raw !== null && typeof raw !== "string") {
    throw new TypeError("session store raw content must be a string or null");
  }
  return raw;
}

function parseStoreFile(raw, file) {
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw sessionStoreError(
      SESSION_STORE_ERROR.CORRUPTED,
      `session store file is corrupted: ${file}`,
      { file },
      cause,
    );
  }
}

export function parseWorkspaceSessionTree({ raw, file }) {
  const treeFile = requireStoreFile(file);
  if (requireRawOrMissing(raw) === null) {
    throw sessionStoreError(
      SESSION_STORE_ERROR.WORKSPACE_NOT_INITIALIZED,
      `workspace not initialized: ${treeFile}`,
      { missingFile: treeFile },
    );
  }
  return normalizeSessionTree(parseStoreFile(raw, treeFile));
}

export function parseWorkspaceSessionTombstones({ raw, file }) {
  const tombstoneFile = requireStoreFile(file);
  if (requireRawOrMissing(raw) === null) return {};
  return {
    ...requireSessionTombstoneSessions(parseStoreFile(raw, tombstoneFile), {
      persistencePath: tombstoneFile,
    }),
  };
}
