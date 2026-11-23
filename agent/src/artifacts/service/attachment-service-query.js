/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path, isPathWithinRoot } from "@noobot/path-resolver";
import {
  fsLstat,
  fsOpen,
  fsReadFile,
  fsRealpath,
  fsStat,
} from "../../shared/storage/fs-adapter.js";
import { safeStr } from "../../shared/utils/shared-utils.js";
import {
  ATTACHMENT_BODY_ERROR_CODE,
  AttachmentProtocolError,
  assertAttachmentBelongsToScope,
  parseAttachmentIdentity,
} from "@noobot/attachment-protocol";
import { listAttachmentRecords, readAttachmentRecords } from "../index-manager.js";
import { resolveAttachmentScope, resolveBasePath } from "./attachment-scope-resolver.js";
import { attachScopeRoot } from "./attachment-storage-layout.js";
import { buildPublicRecord } from "./record-builder.js";

function unavailableBody(record, cause) {
  return new AttachmentProtocolError(
    ATTACHMENT_BODY_ERROR_CODE.UNAVAILABLE,
    {
      attachmentId: record.attachmentId,
      sessionId: record.sessionId,
      attachmentSource: record.attachmentSource,
    },
    { cause },
  );
}

export async function getAttachmentById(
  service,
  { userId, attachmentId, sessionId = "", attachmentSource = "" },
) {
  const id = safeStr(attachmentId);
  const normalizedSessionId = safeStr(sessionId);
  const normalizedAttachmentSource = safeStr(attachmentSource);
  if (!id || !normalizedSessionId || !normalizedAttachmentSource) return null;

  const basePath = resolveBasePath(service.globalConfig, userId);
  const scope = resolveAttachmentScope({
    sessionId: normalizedSessionId,
    attachmentSource: normalizedAttachmentSource,
  });
  const [record] = await readAttachmentMetadata(service, {
    userId,
    identities: [{ ...scope, attachmentId: id }],
  });

  if (!record) return null;

  const storedPath = safeStr(record.path);
  if (!storedPath) throw new Error("attachment_record_path_missing");
  let realStoredPath;
  try {
    realStoredPath = await fsRealpath(storedPath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw unavailableBody(record, error);
    throw error;
  }
  const realScopeRoot = await fsRealpath(attachScopeRoot(basePath, scope));
  if (!isPathWithinRoot(realScopeRoot, realStoredPath)) {
    throw new Error("attachment_real_path_scope_mismatch");
  }
  const resolvedPath = path.resolve(realStoredPath);
  let fileStat;
  try {
    fileStat = await fsStat(resolvedPath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw unavailableBody(record, error);
    throw error;
  }
  if (!fileStat.isFile() || (record.size !== undefined && record.size !== fileStat.size))
    throw unavailableBody(record);
  return {
    ...record,
    absolutePath: resolvedPath,
    size: fileStat.size,
  };
}

export async function readAttachmentMetadata(service, { userId, identities }) {
  const basePath = resolveBasePath(service.globalConfig, userId);
  const scopes = new Map();
  const records = Array(identities.length);
  for (const [index, value] of identities.entries()) {
    const identity = parseAttachmentIdentity(value);
    const scope = resolveAttachmentScope(identity);
    assertAttachmentBelongsToScope(identity, scope);
    const key = JSON.stringify([scope.sessionId, scope.attachmentSource]);
    const selection = scopes.get(key) ?? { scope, ids: [], positions: [] };
    selection.ids.push(identity.attachmentId);
    selection.positions.push(index);
    scopes.set(key, selection);
  }
  for (const { scope, ids, positions } of scopes.values()) {
    const selected = await readAttachmentRecords(basePath, scope, ids);
    for (const [index, record] of selected.entries()) {
      records[positions[index]] = record === null ? null : buildPublicRecord(basePath, record);
    }
  }
  return records;
}

export async function readAttachmentMetas(
  service,
  { userId, sessionId = "", attachmentSource = "" } = {},
) {
  const basePath = resolveBasePath(service.globalConfig, userId);
  const scope = resolveAttachmentScope({ sessionId, attachmentSource });
  return (await listAttachmentRecords(basePath, scope)).map((record) =>
    buildPublicRecord(basePath, record),
  );
}

export async function readAttachmentContent(
  service,
  { userId, attachmentId, sessionId = "", attachmentSource = "" },
) {
  const record = await getAttachmentById(service, {
    userId,
    attachmentId,
    sessionId,
    attachmentSource,
  });
  if (!record) return null;
  return { ...record, content: await fsReadFile(record.absolutePath) };
}

export async function openAttachmentStream(service, identity) {
  const record = await getAttachmentById(service, identity);
  if (!record) return null;

  let handle;
  try {
    const pathStat = await fsLstat(record.absolutePath);
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) throw unavailableBody(record);
    handle = await fsOpen(record.absolutePath, "r");
    const openedStat = await handle.stat();
    if (
      !openedStat.isFile() ||
      openedStat.dev !== pathStat.dev ||
      openedStat.ino !== pathStat.ino ||
      openedStat.size !== record.size
    ) {
      throw unavailableBody(record);
    }
    const {
      absolutePath: _absolutePath,
      path: _storagePath,
      relativePath: _storageRef,
      ...publicRecord
    } = record;
    return {
      ...publicRecord,
      size: openedStat.size,
      createReadStream: (range) => handle.createReadStream({ ...range, autoClose: false }),
      close: () => handle.close(),
    };
  } catch (error) {
    try {
      await handle?.close?.();
    } catch (closeError) {
      error.closeError = closeError;
    }
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw unavailableBody(record, error);
    throw error;
  }
}
