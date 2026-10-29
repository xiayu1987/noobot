/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createFileAccessTraceId,
  maskWorkspacePath,
  resolveFileItemName,
  resolveFileItemRelativePath,
} from "./path-utils.js";
import { text } from "@noobot/shared/value";

export function createFileAccessContext(action, fileItem, userId) {
  const traceId = createFileAccessTraceId(action);
  const normalizedUserId = text(userId);
  const relativePath = resolveFileItemRelativePath(fileItem, normalizedUserId);
  return {
    traceId,
    normalizedUserId,
    relativePath,
    fileName: resolveFileItemName(fileItem, relativePath),
  };
}

export function buildFileAccessLogPayload(context, fileItem) {
  return {
    traceId: context.traceId,
    hasUserId: Boolean(context.normalizedUserId),
    hasRelativePath: Boolean(fileItem?.relativePath),
    hasFileName: Boolean(fileItem?.fileName || fileItem?.name),
    hasResolvedPath: Boolean(fileItem?.resolvedPath),
    relativePath: maskWorkspacePath(context.relativePath),
  };
}

export function validateFileAccessContext(context, fileItem) {
  if (context.normalizedUserId && context.relativePath && context.fileName) return { valid: true };
  return {
    valid: false,
    reason: "missingWorkspaceMetadata",
    hasUserId: Boolean(context.normalizedUserId),
    hasRelativePath: Boolean(fileItem?.relativePath),
    hasFileName: Boolean(fileItem?.fileName || fileItem?.name),
    hasResolvedPath: Boolean(fileItem?.resolvedPath),
  };
}
