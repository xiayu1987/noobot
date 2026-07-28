/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "../../shared/utils/path-resolver.js";
import { fsAccess, fsReadFile, fsStat } from "../../shared/storage/fs-adapter.js";
import { safeNum, safeStr } from "../../shared/utils/shared-utils.js";
import { readAttachIndex } from "../index-manager.js";
import { findRecordAcrossScopedIndexes, resolveAttachmentScope, resolveBasePath } from "./attachment-scope-resolver.js";
import { buildPublicRecord } from "./record-builder.js";

export async function getAttachmentById(service, { userId, attachmentId, sessionId = "", attachmentSource = "" }) {
  const id = safeStr(attachmentId);
  if (!id) return null;

  const basePath = resolveBasePath(service.globalConfig, userId);
  const scope = resolveAttachmentScope({ sessionId, attachmentSource });
  const hasExplicitScope = safeStr(sessionId) || safeStr(attachmentSource);

  const record = hasExplicitScope
    ? (await readAttachIndex(basePath, scope))?.attachments?.[id] || null
    : await findRecordAcrossScopedIndexes(basePath, id);

  if (!record) return null;

  const resolvedPath = safeStr(record.path);
  if (!resolvedPath) return null;

  try {
    await fsAccess(resolvedPath);
  } catch {
    return null;
  }

  const fileStat = await fsStat(resolvedPath);
  return {
    ...buildPublicRecord(basePath, record),
    absolutePath: resolvedPath,
    size: safeNum(fileStat?.size, record.size || 0),
  };
}

export async function readAttachmentMetas(service, { userId, sessionId = "", attachmentSource = "" } = {}) {
  const basePath = resolveBasePath(service.globalConfig, userId);
  const scope = resolveAttachmentScope({ sessionId, attachmentSource });
  const index = await readAttachIndex(basePath, scope);
  return Object.values(index?.attachments || {}).map((record) => buildPublicRecord(basePath, record));
}

function normalizeComparablePath(basePath, filePath = "") {
  const normalized = safeStr(filePath);
  if (!normalized) return "";
  return path.resolve(path.isAbsolute(normalized) ? normalized : path.join(basePath, normalized));
}

export async function resolveSourceAttachment(service, {
  userId,
  sessionId = "",
  attachmentId = "",
  attachmentSource = "user",
  filePath = "",
  clientAttachmentId = "",
  contentSha256 = "",
} = {}) {
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
    if (matchedById && !safeStr(filePath)) return matchedById;
  }

  const basePath = resolveBasePath(service.globalConfig, userId);
  const metas = await readAttachmentMetas(service, {
    userId,
    sessionId: normalizedSessionId,
    attachmentSource,
  });
  const normalizedClientAttachmentId = safeStr(clientAttachmentId);
  if (normalizedClientAttachmentId) {
    const matchedByClientId = metas.find(
      (item) => safeStr(item?.clientAttachmentId) === normalizedClientAttachmentId,
    );
    if (matchedByClientId) return matchedByClientId;
  }

  const comparableInputPath = normalizeComparablePath(basePath, filePath);
  if (comparableInputPath) {
    const matchedByPath = metas.find((item) => {
      const recordPath = normalizeComparablePath(basePath, item?.path);
      const relativePath = normalizeComparablePath(basePath, item?.relativePath);
      return recordPath === comparableInputPath || relativePath === comparableInputPath;
    });
    if (matchedById && matchedByPath) {
      return safeStr(matchedById?.attachmentId) === safeStr(matchedByPath?.attachmentId)
        ? matchedById
        : null;
    }
    if (matchedById) return null;
    if (matchedByPath) return matchedByPath;
  }

  const normalizedContentSha256 = safeStr(contentSha256);
  if (normalizedContentSha256) {
    return metas.find((item) => safeStr(item?.contentSha256) === normalizedContentSha256) || null;
  }
  return null;
}

export async function readAttachmentContent(service, { userId, attachmentId }) {
  const record = await getAttachmentById(service, { userId, attachmentId });
  if (!record) return null;
  return { ...record, content: await fsReadFile(record.absolutePath) };
}
