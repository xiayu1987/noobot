/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

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

/**
 * 读取附件内容。
 */
export async function readAttachmentContent(service, { userId, attachmentId }) {
  const record = await getAttachmentById(service, { userId, attachmentId });
  if (!record) return null;
  return { ...record, content: await fsReadFile(record.absolutePath) };
}
