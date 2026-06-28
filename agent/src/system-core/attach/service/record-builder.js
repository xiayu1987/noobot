/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import path from "node:path";

import { DEFAULT_ATTACHMENT_SESSION_ID, DEFAULT_ATTACHMENT_SOURCE, DEFAULT_MIME_TYPE, MIME_TO_EXTENSION, MAX_EXTENSION_LENGTH } from "../constants.js";
import {
  normalizeAttachmentOwnerMeta,
  normalizeAttachmentParsedResultMeta,
  normalizeAttachmentTurnScopeMeta,
} from "../meta-ops.js";
import { safeNum, safeStr } from "../../utils/shared-utils.js";

/**
 * 归一化相对路径（统一 posix 分隔符）。
 *
 * @param {string} basePath - 基准路径。
 * @param {string} absolutePath - 绝对路径。
 * @returns {string}
 */
export function normalizeRelativePath(basePath, absolutePath) {
  return path.relative(basePath, absolutePath).split(path.sep).join(path.posix.sep);
}

/**
 * 构建公共附件记录。
 *
 * @param {string} basePath - 用户根路径。
 * @param {object} record - 原始记录。
 * @returns {object}
 */
export function buildPublicRecord(basePath, record) {
  const owner = normalizeAttachmentOwnerMeta(record);
  const turnScope = normalizeAttachmentTurnScopeMeta(record, owner);
  const parsedResult = normalizeAttachmentParsedResultMeta(record);
  return {
    attachmentId: safeStr(record.attachmentId),
    name: safeStr(record.name),
    mimeType: safeStr(record.mimeType, DEFAULT_MIME_TYPE),
    size: safeNum(record.size),
    path: safeStr(record.path),
    relativePath: safeStr(record.relativePath) || normalizeRelativePath(basePath, safeStr(record.path)),
    createdAt: safeStr(record.createdAt, new Date().toISOString()),
    sessionId: safeStr(record.sessionId, DEFAULT_ATTACHMENT_SESSION_ID),
    attachmentSource: safeStr(record.attachmentSource, DEFAULT_ATTACHMENT_SOURCE),
    generatedByModel: record?.generatedByModel === true,
    generationSource: safeStr(record.generationSource),
    ...(typeof record?.isSandbox === "boolean" ? { isSandbox: record.isSandbox } : {}),
    ...(owner ? { owner } : {}),
    ...(turnScope ? { turnScope } : {}),
    ...(parsedResult ? { parsedResult } : {}),
  };
}

/**
 * 根据文件名或 MIME 推导扩展名。
 *
 * @param {string} fileName - 文件名。
 * @param {string} mimeType - MIME 类型。
 * @returns {string}
 */
export function normalizeExtension(fileName, mimeType) {
  const fromName = path.extname(safeStr(fileName)).slice(0, MAX_EXTENSION_LENGTH);
  if (fromName) return fromName;
  return (MIME_TO_EXTENSION[safeStr(mimeType).toLowerCase()] || "").slice(0, MAX_EXTENSION_LENGTH);
}
