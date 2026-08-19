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
import { safeNum, safeStr } from "../../shared/utils/shared-utils.js";
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
  if (!storedPath) return null;
  let resolvedPath;
  try {
    const [realScopeRoot, realStoredPath] = await Promise.all([
      fsRealpath(attachScopeRoot(basePath, scope)),
      fsRealpath(storedPath),
    ]);
    if (!isPathWithinRoot(realScopeRoot, realStoredPath)) {
      throw new Error("attachment_real_path_scope_mismatch");
    }
    resolvedPath = path.resolve(realStoredPath);
  } catch {
    return null;
  }

  const fileStat = await fsStat(resolvedPath);
  if (!fileStat?.isFile?.()) return null;
  return {
    ...buildPublicRecord(basePath, record),
    absolutePath: resolvedPath,
    size: safeNum(fileStat?.size, record.size || 0),
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

export async function resolveSourceAttachment(
  service,
  { userId, sessionId = "", attachmentId = "", attachmentSource = "user" } = {},
) {
  const normalizedSessionId = safeStr(sessionId);
  if (!normalizedSessionId) return null;

  const normalizedAttachmentId = safeStr(attachmentId);
  let matchedById = null;
  if (normalizedAttachmentId) {
    matchedById = await getAttachmentById(service, {
      userId,
      attachmentId: normalizedAttachmentId,
      sessionId: normalizedSessionId,
      attachmentSource,
    });
    if (matchedById) return matchedById;
  }

  const basePath = resolveBasePath(service.globalConfig, userId);
  const metas = await readAttachmentMetas(service, {
    userId,
    sessionId: normalizedSessionId,
    attachmentSource,
  });
  void basePath;
  void metas;
  return null;
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
      size: safeNum(openedStat.size, record.size || 0),
      stream: handle.createReadStream(),
    };
  } catch (error) {
    try {
      await handle?.close?.();
    } catch (closeError) {
      error.closeError = closeError;
    }
    return null;
  }
}
