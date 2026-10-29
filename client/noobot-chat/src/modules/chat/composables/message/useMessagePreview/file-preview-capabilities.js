/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isNonImagePreviewOverSizeLimit } from "./file-type.js";
import { resolveFileItemName, resolveFileItemRelativePath } from "./path-utils.js";
import { text } from "@noobot/shared/value";

export function canPreviewFileItem(fileItem, userId, isImageMime) {
  const normalizedUserId = text(userId);
  const relativePath = resolveFileItemRelativePath(fileItem, normalizedUserId);
  const fileName = resolveFileItemName(fileItem, relativePath);
  const mimeType = text(fileItem?.mimeType || fileItem?.type);
  if (!relativePath) return false;
  return !isNonImagePreviewOverSizeLimit({
    fileItem,
    mimeType,
    fileName,
    isImageMimeChecker: isImageMime,
  });
}
