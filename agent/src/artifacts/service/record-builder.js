/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "@noobot/path-resolver";

import { DEFAULT_MIME_TYPE, MIME_TO_EXTENSION, MAX_EXTENSION_LENGTH } from "../constants.js";
import {
  normalizeAttachmentOwnerMeta,
  normalizeAttachmentTurnScopeMeta,
  projectCanonicalAttachmentIdentity,
} from "../meta-ops.js";
import { safeNum, safeStr } from "../../shared/utils/shared-utils.js";

export function normalizeRelativePath(basePath, absolutePath) {
  return path.relative(basePath, absolutePath).split(path.sep).join("/");
}

export function buildPublicRecord(basePath, record) {
  const identity = projectCanonicalAttachmentIdentity(record);
  const owner = normalizeAttachmentOwnerMeta(record);
  const turnScope = normalizeAttachmentTurnScopeMeta(record, owner);
  return {
    attachmentId: identity.attachmentId,
    ...(safeStr(record.clientAttachmentId) ? { clientAttachmentId: safeStr(record.clientAttachmentId) } : {}),
    ...(safeStr(record.contentSha256) ? { contentSha256: safeStr(record.contentSha256) } : {}),
    name: safeStr(record.name),
    mimeType: safeStr(record.mimeType, DEFAULT_MIME_TYPE),
    size: safeNum(record.size),
    path: safeStr(record.path),
    relativePath: safeStr(record.relativePath) || normalizeRelativePath(basePath, safeStr(record.path)),
    createdAt: safeStr(record.createdAt, new Date().toISOString()),
    sessionId: identity.sessionId,
    attachmentSource: identity.attachmentSource,
    generatedByModel: record?.generatedByModel === true,
    generationSource: safeStr(record.generationSource),
    ...(typeof record?.isSandbox === "boolean" ? { isSandbox: record.isSandbox } : {}),
    ...(owner ? { owner } : {}),
    ...(turnScope ? { turnScope } : {}),
    relations: Array.isArray(record?.relations) ? record.relations : [],
  };
}

export function normalizeExtension(fileName, mimeType) {
  const fromName = path.extname(safeStr(fileName)).slice(0, MAX_EXTENSION_LENGTH);
  if (fromName) return fromName;
  return (MIME_TO_EXTENSION[safeStr(mimeType).toLowerCase()] || "").slice(0, MAX_EXTENSION_LENGTH);
}
