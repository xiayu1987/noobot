/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "../../shared/utils/path-resolver.js";

import { safeStr } from "../../shared/utils/shared-utils.js";
import { MIME_TO_EXTENSION } from "../constants.js";

export function getMimeTypeFromExtension(fileNameOrExtension = "") {
  const raw = safeStr(fileNameOrExtension).toLowerCase();
  if (!raw) return "";

  const ext = raw.startsWith(".")
    ? raw
    : safeStr(path.extname(raw)).toLowerCase();

  const entries = Object.entries(MIME_TO_EXTENSION || {});
  for (const [mimeType, extension] of entries) {
    if (safeStr(extension).toLowerCase() === ext) {
      return safeStr(mimeType);
    }
  }
  return "";
}

export function isValidMimeType(mimeType = "") {
  return Boolean(safeStr(mimeType).trim());
}
