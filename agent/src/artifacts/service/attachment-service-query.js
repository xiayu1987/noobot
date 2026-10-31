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
import { readAttachIndex } from "../index-manager.js";
import { resolveAttachmentScope, resolveBasePath } from "./attachment-scope-resolver.js";
import { attachScopeRoot } from "./attachment-storage-layout.js";
import { buildPublicRecord } from "./record-builder.js";

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
  const record = (await readAttachIndex(basePath, scope))?.attachments?.[id] || null;

  if (!record) return null;

  const storedPath = safeStr(record.path);
  if (!storedPath) throw new Error("attachment_record_path_missing");
  let realStoredPath;
  try {
    realStoredPath = await fsRealpath(storedPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const realScopeRoot = await fsRealpath(attachScopeRoot(basePath, scope));
  if (!isPathWithinRoot(realScopeRoot, realStoredPath)) {
    throw new Error("attachment_real_path_scope_mismatch");
  }
  const resolvedPath = path.resolve(realStoredPath);
  const fileStat = await fsStat(resolvedPath);
  if (!fileStat.isFile()) throw new Error("attachment_path_not_file");
  return {
    ...buildPublicRecord(basePath, record),
    absolutePath: resolvedPath,
    size: fileStat.size,
  };
}

export async function readAttachmentMetas(
  service,
  { userId, sessionId = "", attachmentSource = "" } = {},
) {
  const basePath = resolveBasePath(service.globalConfig, userId);
  const scope = resolveAttachmentScope({ sessionId, attachmentSource });
  const index = await readAttachIndex(basePath, scope);
  return Object.values(index?.attachments || {}).map((record) =>
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
    if (!pathStat?.isFile?.() || pathStat?.isSymbolicLink?.()) return null;
    handle = await fsOpen(record.absolutePath, "r");
    const openedStat = await handle.stat();
    if (
      !openedStat?.isFile?.() ||
      openedStat.dev !== pathStat.dev ||
      openedStat.ino !== pathStat.ino
    ) {
      await handle.close();
      return null;
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
      stream: handle.createReadStream(),
    };
  } catch (error) {
    try {
      await handle?.close?.();
    } catch (closeError) {
      error.closeError = closeError;
    }
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}
