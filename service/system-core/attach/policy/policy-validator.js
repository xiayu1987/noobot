/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import path from "node:path";

import { safeStr } from "../../utils/shared-utils.js";

/**
 * 解析并规范化附件策略。
 *
 * @param {object} [policy] - 用户策略。
 * @returns {{maxFileSizeBytes: number, maxTotalSizeBytes: number, maxFileCount: number, allowedMimeTypes: string[], allowedExtensions: string[]}}
 */
export function resolveAttachmentPolicy(policy = {}) {
  const config = policy && typeof policy === "object" ? policy : {};

  const toPositiveInt = (val) => {
    const n = Number(val ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };

  return {
    maxFileSizeBytes: toPositiveInt(config?.maxFileSizeBytes),
    maxTotalSizeBytes: toPositiveInt(config?.maxTotalSizeBytes),
    maxFileCount: toPositiveInt(config?.maxFileCount),
    allowedMimeTypes: normalizeStringArray(config?.allowedMimeTypes),
    allowedExtensions: normalizeExtensions(config?.allowedExtensions),
  };
}

function normalizeStringArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((item) => safeStr(item).toLowerCase()).filter(Boolean);
}

function normalizeExtensions(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => {
      const normalized = safeStr(item).toLowerCase();
      if (!normalized) return "";
      return normalized.startsWith(".") ? normalized : `.${normalized}`;
    })
    .filter(Boolean);
}

/**
 * 校验 MIME 类型是否在白名单中。
 *
 * @param {string} [mimeType] - MIME 类型。
 * @param {string[]} [allowedMimeTypes] - 白名单。
 * @returns {boolean}
 */
export function isMimeTypeAllowed(mimeType = "", allowedMimeTypes = []) {
  const normalized = safeStr(mimeType).toLowerCase();
  if (!Array.isArray(allowedMimeTypes) || !allowedMimeTypes.length || !normalized) return true;

  return allowedMimeTypes.some((allowed) => {
    const norm = safeStr(allowed).toLowerCase();
    if (!norm) return false;
    if (norm.endsWith("/*")) {
      return normalized.startsWith(norm.slice(0, -1));
    }
    return normalized === norm;
  });
}

/**
 * 校验文件扩展名是否在白名单中。
 *
 * @param {string} [fileName] - 文件名。
 * @param {string[]} [allowedExtensions] - 白名单。
 * @returns {boolean}
 */
export function isExtensionAllowed(fileName = "", allowedExtensions = []) {
  if (!Array.isArray(allowedExtensions) || !allowedExtensions.length) return true;

  const ext = safeStr(path.extname(safeStr(fileName))).toLowerCase();
  if (!ext) return false;
  return allowedExtensions.includes(ext);
}

/**
 * 向后兼容别名。
 *
 * @param {object} [policy] - 用户策略。
 * @returns {ReturnType<typeof resolveAttachmentPolicy>}
 */
export function validateAttachmentPolicy(policy = {}) {
  return resolveAttachmentPolicy(policy);
}
