/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "@noobot/path-resolver";

import { safeStr } from "../../shared/utils/shared-utils.js";

export function isMimeTypeAllowed(mimeType, allowedMimeTypes) {
  const normalized = safeStr(mimeType).toLowerCase();
  if (!allowedMimeTypes.length || !normalized) return true;

  return allowedMimeTypes.some((allowed) => {
    const norm = safeStr(allowed).toLowerCase();
    if (!norm) return false;
    if (norm.endsWith("/*")) {
      return normalized.startsWith(norm.slice(0, -1));
    }
    return normalized === norm;
  });
}

export function isExtensionAllowed(fileName, allowedExtensions) {
  if (!allowedExtensions.length) return true;

  const ext = safeStr(path.extname(safeStr(fileName))).toLowerCase();
  if (!ext) return false;
  return allowedExtensions.includes(ext);
}
