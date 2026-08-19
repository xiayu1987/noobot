/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isNonImagePreviewOverSizeLimit } from "./file-type.js";
import {
  resolveFileItemHostPath,
  resolveFileItemName,
  resolveFileItemRelativePath,
} from "./path-utils.js";

export function canPreviewFileItem(fileItem, userId, isImageMime) {
  const normalizedUserId = String(userId || "").trim();
  const relativePath = resolveFileItemRelativePath(fileItem, normalizedUserId);
  const fileName = resolveFileItemName(fileItem, relativePath);
  const mimeType = String(fileItem?.mimeType || fileItem?.type || "").trim();
  const hasPreviewPath = Boolean(
    relativePath || resolveFileItemHostPath(fileItem) || fileItem?.resolvedPath || fileItem?.path,
  );
  if (!hasPreviewPath) return false;
  return !isNonImagePreviewOverSizeLimit({
    fileItem,
    mimeType,
    fileName,
    isImageMimeChecker: isImageMime,
  });
}
