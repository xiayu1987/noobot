/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { fsAccess, fsReadFile, fsStat } from "../../shared/storage/fs-adapter.js";
import { safeNum, safeStr } from "../../shared/utils/shared-utils.js";
import { readAttachIndex } from "../index-manager.js";
import { resolveAttachmentScope, resolveBasePath } from "./attachment-scope-resolver.js";
import { buildPublicRecord } from "./record-builder.js";

export async function getAttachmentById(service, { userId, attachmentId, sessionId = "", attachmentSource = "" }) {
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

export async function resolveSourceAttachment(service, {
  userId,
  sessionId = "",
  attachmentId = "",
  attachmentSource = "user",
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

export async function readAttachmentContent(service, {
  userId,
  attachmentId,
  sessionId = "",
  attachmentSource = "",
}) {
  const record = await getAttachmentById(service, {
    userId,
    attachmentId,
    sessionId,
    attachmentSource,
  });
  if (!record) return null;
  return { ...record, content: await fsReadFile(record.absolutePath) };
}
