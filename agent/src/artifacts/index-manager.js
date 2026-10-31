/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "@noobot/path-resolver";
import { fsMkdir, fsReadFile, fsRename, fsRm, fsWriteFile } from "../shared/storage/fs-adapter.js";
import { parsePersistedAttachmentIndex, requirePlainObject } from "@noobot/attachment-protocol";
import {
  fromPersistedAttachmentRecord,
  toPersistedAttachmentRecord,
} from "./service/persisted-record-adapter.js";
import { attachmentScopeIndexPath } from "./service/attachment-storage-layout.js";
import { FileMutationCoordinator } from "../shared/storage/file-mutation-coordinator.js";

const scopeLocks = new Map();
const attachmentIndexCoordinator = new FileMutationCoordinator({
  timeoutMessage: "attachment index lock timeout",
  timeoutErrorCode: "ATTACHMENT_INDEX_BUSY",
  operationName: "attachmentIndex.refreshLock",
});

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
    return await attachmentIndexCoordinator.run(`${key}.lock`, operation);
  } finally {
    release();
    if (scopeLocks.get(key) === current) scopeLocks.delete(key);
  }
}

export async function readAttachIndex(basePath, scope) {
  const indexFile = resolveIndexFile(basePath, scope);
  return attachmentIndexCoordinator.run(`${indexFile}.lock`, async () => {
    await fsMkdir(path.dirname(indexFile), { recursive: true });
    let raw;
    try {
      raw = await fsReadFile(indexFile, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return emptyIndex(scope);
    }
    const parsed = parsePersistedAttachmentIndex(JSON.parse(raw), scope);
    const attachments = {};
    for (const [key, persisted] of Object.entries(parsed.attachments)) {
      attachments[key] = fromPersistedAttachmentRecord(basePath, persisted);
    }
    return {
      updatedAt: parsed.updatedAt,
      sessionId: scope.sessionId,
      attachmentSource: scope.attachmentSource,
      attachments,
    };
  });
}

export async function writeAttachIndex(basePath, indexData, scope) {
  const indexFile = resolveIndexFile(basePath, scope);
  return attachmentIndexCoordinator.run(`${indexFile}.lock`, async () => {
    await fsMkdir(path.dirname(indexFile), { recursive: true });
    const attachments = {};
    for (const [key, value] of Object.entries(
      requirePlainObject(indexData?.attachments, "invalid_attachment_index_entries"),
    )) {
      const persisted = toPersistedAttachmentRecord(basePath, value);
      attachments[key] = persisted;
    }
    const serialized = JSON.stringify(
      parsePersistedAttachmentIndex(
        {
          updatedAt: new Date().toISOString(),
          sessionId: scope.sessionId,
          attachmentSource: scope.attachmentSource,
          attachments,
        },
        scope,
      ),
      null,
      2,
    );
    const temporaryIndexFile = `${indexFile}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    try {
      await fsWriteFile(temporaryIndexFile, serialized, "utf8");
      await fsRename(temporaryIndexFile, indexFile);
    } finally {
      await fsRm(temporaryIndexFile, { force: true });
    }
  });
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
