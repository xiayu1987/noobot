/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "@noobot/path-resolver";
import { fsMkdir, fsReadFile, fsWriteFile } from "../shared/storage/fs-adapter.js";
import {
  assertAttachmentBelongsToScope,
  parsePersistedAttachmentRecord,
} from "@noobot/attachment-protocol";
import {
  fromPersistedAttachmentRecord,
  toPersistedAttachmentRecord,
} from "./service/persisted-record-adapter.js";
import { attachmentScopeIndexPath } from "./service/attachment-storage-layout.js";

// Index updates are read-modify-write transactions. Serialize them per canonical
// attachment scope so concurrent producers cannot overwrite each other's records.
const scopeLocks = new Map();

export async function withAttachIndexLock(basePath, scope, operation) {
  const key = resolveIndexFile(basePath, scope);
  const previous = scopeLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  scopeLocks.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (scopeLocks.get(key) === current) scopeLocks.delete(key);
  }
}

export async function readAttachIndex(basePath, scope) {
  const indexFile = resolveIndexFile(basePath, scope);
  await fsMkdir(path.dirname(indexFile), { recursive: true });
  let raw;
  try {
    raw = await fsReadFile(indexFile, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return emptyIndex(scope);
  }
  const parsed = JSON.parse(raw);
  if (
    parsed?.sessionId !== scope.sessionId ||
    parsed?.attachmentSource !== scope.attachmentSource
  ) {
    throw new Error("attachment_index_scope_mismatch");
  }
  const attachments = {};
  for (const [key, value] of Object.entries(
    isObject(parsed.attachments) ? parsed.attachments : {},
  )) {
    const persisted = parsePersistedAttachmentRecord(value);
    assertAttachmentBelongsToScope(persisted.identity, scope);
    if (key !== persisted.identity.attachmentId) throw new Error("attachment_index_key_mismatch");
    attachments[key] = fromPersistedAttachmentRecord(basePath, persisted);
  }
  return {
    updatedAt: String(parsed.updatedAt),
    sessionId: scope.sessionId,
    attachmentSource: scope.attachmentSource,
    attachments,
  };
}

export async function writeAttachIndex(basePath, indexData, scope) {
  const indexFile = resolveIndexFile(basePath, scope);
  await fsMkdir(path.dirname(indexFile), { recursive: true });
  const attachments = {};
  for (const [key, value] of Object.entries(
    isObject(indexData?.attachments) ? indexData.attachments : {},
  )) {
    const persisted = toPersistedAttachmentRecord(basePath, value, scope);
    if (!persisted) throw new Error("invalid_persisted_attachment_record");
    assertAttachmentBelongsToScope(persisted.identity, scope);
    if (key !== persisted.identity.attachmentId) throw new Error("attachment_index_key_mismatch");
    attachments[key] = persisted;
  }
  await fsWriteFile(
    indexFile,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        sessionId: scope.sessionId,
        attachmentSource: scope.attachmentSource,
        attachments,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function emptyIndex(scope) {
  return {
    updatedAt: new Date().toISOString(),
    sessionId: scope.sessionId,
    attachmentSource: scope.attachmentSource,
    attachments: {},
  };
}

function resolveIndexFile(basePath, scope) {
  return attachmentScopeIndexPath(basePath, scope);
}

function isObject(val) {
  return val && typeof val === "object" && !Array.isArray(val);
}
