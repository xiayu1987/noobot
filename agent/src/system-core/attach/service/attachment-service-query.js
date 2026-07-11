/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import path from "node:path";
import { fsAccess, fsReadFile, fsStat } from "../../store/fs-adapter.js";
import { safeNum, safeStr } from "../../utils/shared-utils.js";
import { readAttachIndex } from "../index-manager.js";
import { findRecordAcrossScopedIndexes, resolveAttachmentScope, resolveBasePath } from "./path-resolver.js";
import { buildPublicRecord } from "./record-builder.js";

/**
 * 按附件 ID 查询附件元数据与绝对路径。
 */
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

/**
 * 读取某个 scope 下的附件元数据列表。
 */
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

/**
 * Resolve the canonical source attachment for a tool input inside one session.
 * Identity is preferred; path matching is exact and scoped, never filename based.
 */
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
  if (normalizedAttachmentId) {
    return getAttachmentById(service, {
      userId,
      attachmentId: normalizedAttachmentId,
      sessionId: normalizedSessionId,
      attachmentSource,
    });
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
    if (matchedByPath) return matchedByPath;
  }

  const normalizedContentSha256 = safeStr(contentSha256);
  if (normalizedContentSha256) {
    return metas.find((item) => safeStr(item?.contentSha256) === normalizedContentSha256) || null;
  }
  return null;
}

/**
 * 读取附件内容。
 */
export async function readAttachmentContent(service, { userId, attachmentId }) {
  const record = await getAttachmentById(service, { userId, attachmentId });
  if (!record) return null;
  return { ...record, content: await fsReadFile(record.absolutePath) };
}
