/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { filePath as path } from "../../shared/utils/path-resolver.js";

import { BUILTIN_ATTACHMENT_POLICY } from "../../config/index.js";
import { safeStr } from "../../shared/utils/shared-utils.js";

export function resolveAttachmentPolicy(policy = {}) {
  const config = policy && typeof policy === "object" ? policy : {};

  return {
    maxFileSizeBytes: BUILTIN_ATTACHMENT_POLICY.maxFileSizeBytes,
    maxTotalSizeBytes: BUILTIN_ATTACHMENT_POLICY.maxTotalSizeBytes,
    maxFileCount: BUILTIN_ATTACHMENT_POLICY.maxFileCount,
    allowedMimeTypes: normalizeStringArray(BUILTIN_ATTACHMENT_POLICY.allowedMimeTypes),
    allowedExtensions: normalizeExtensions(BUILTIN_ATTACHMENT_POLICY.allowedExtensions),
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

export function isExtensionAllowed(fileName = "", allowedExtensions = []) {
  if (!Array.isArray(allowedExtensions) || !allowedExtensions.length) return true;

  const ext = safeStr(path.extname(safeStr(fileName))).toLowerCase();
  if (!ext) return false;
  return allowedExtensions.includes(ext);
}

export function validateAttachmentPolicy(policy = {}) {
  return resolveAttachmentPolicy(policy);
}
