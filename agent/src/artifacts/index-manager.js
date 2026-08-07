/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "../shared/utils/path-resolver.js";
import { fsMkdir, fsReadFile, fsWriteFile } from "../shared/storage/fs-adapter.js";
import {
  applyAttachmentDisplayProjection,
  fromPersistedAttachmentRecord,
  toAttachmentDisplayProjection,
  toPersistedAttachmentRecord,
} from "./service/persisted-record-adapter.js";

export async function readAttachIndex(basePath, scope) {
  const indexFile = resolveIndexFile(basePath, scope);
  await fsMkdir(path.dirname(indexFile), { recursive: true });

  try {
    const raw = await fsReadFile(indexFile, "utf8");
    const parsed = JSON.parse(raw);
    const rawAttachments = isObject(parsed?.attachments) ? parsed.attachments : {};
    const views = isObject(parsed?.attachmentViews) ? parsed.attachmentViews : {};
    const attachments = {};
    for (const [key, value] of Object.entries(rawAttachments)) {
      try {
        const legacyView = value?.identity && value?.descriptor && value?.storageRef
          ? {}
          : toAttachmentDisplayProjection(value);
        const persisted = value?.identity && value?.descriptor && value?.storageRef
          ? value
          : toPersistedAttachmentRecord(basePath, value, scope);
        if (!persisted) continue;
        const record = fromPersistedAttachmentRecord(basePath, persisted);
        attachments[key] = applyAttachmentDisplayProjection(
          record,
          views[identityViewKey(record)] || legacyView,
        );
      } catch {
        // Invalid historical records are not allowed into the canonical read model.
      }
    }
    return {
      updatedAt: String(parsed?.updatedAt || new Date().toISOString()),
      sessionId: String(parsed?.sessionId || scope.sessionId),
      attachmentSource: String(parsed?.attachmentSource || scope.attachmentSource),
      attachments,
    };
  } catch {
    return {
      updatedAt: new Date().toISOString(),
      sessionId: scope.sessionId,
      attachmentSource: scope.attachmentSource,
      attachments: {},
    };
  }
}

export async function writeAttachIndex(basePath, indexData, scope) {
  const indexFile = resolveIndexFile(basePath, scope);
  await fsMkdir(path.dirname(indexFile), { recursive: true });

  const attachments = {};
  const attachmentViews = {};
  for (const [key, value] of Object.entries(isObject(indexData?.attachments) ? indexData.attachments : {})) {
    const persisted = value?.identity && value?.descriptor && value?.storageRef
      ? value
      : toPersistedAttachmentRecord(basePath, value, scope);
    if (!persisted) continue;
    attachments[key] = persisted;
    const view = toAttachmentDisplayProjection(value);
    if (Object.keys(view).length) attachmentViews[identityViewKey(persisted)] = view;
  }
  const payload = {
    updatedAt: new Date().toISOString(),
    sessionId: scope.sessionId,
    attachmentSource: scope.attachmentSource,
    attachments,
    ...(Object.keys(attachmentViews).length ? { attachmentViews } : {}),
  };
  await fsWriteFile(indexFile, JSON.stringify(payload, null, 2), "utf8");
}

function identityViewKey(record) {
  const identity = record?.identity || record;
  return JSON.stringify([
    String(identity?.attachmentId || ""),
    String(identity?.sessionId || ""),
    String(identity?.attachmentSource || ""),
  ]);
}

function resolveIndexFile(basePath, scope) {
  return path.join(
    basePath,
    "runtime/attach/scoped",
    scope.sessionId,
    scope.attachmentSource,
    "attachments.json",
  );
}

function isObject(val) {
  return val && typeof val === "object" && !Array.isArray(val);
}
