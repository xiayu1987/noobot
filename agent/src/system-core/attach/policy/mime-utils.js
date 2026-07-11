/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "../../utils/path-resolver.js";

import { safeStr } from "../../utils/shared-utils.js";
import { MIME_TO_EXTENSION } from "../constants.js";

/**
 * 根据扩展名或文件名解析 MIME 类型。
 *
 * @param {string} fileNameOrExtension - 文件名或扩展名。
 * @returns {string}
 */
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

/**
 * 判断 MIME 类型字符串是否有效。
 *
 * @param {string} mimeType - MIME 字符串。
 * @returns {boolean}
 */
export function isValidMimeType(mimeType = "") {
  return Boolean(safeStr(mimeType).trim());
}
