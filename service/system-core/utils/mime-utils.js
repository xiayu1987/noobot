/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * MIME 类型到文件扩展名的映射表
 */
const MIME_EXTENSION_MAP = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "video/x-m4v": ".m4v",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/webm": ".webm",
  "application/pdf": ".pdf",
  "application/json": ".json",
  "text/plain": ".txt",
};

/**
 * 根据 MIME 类型前缀推断默认扩展名
 */
const MIME_PREFIX_FALLBACKS = {
  "image/": ".png",
  "video/": ".mp4",
  "audio/": ".mp3",
};

/**
 * 获取完整的 MIME 映射表
 */
export function getMimeExtensionMap() {
  return { ...MIME_EXTENSION_MAP };
}

/**
 * 根据 MIME 类型获取文件扩展名
 * @param {string} mimeType - MIME 类型
 * @returns {string} 文件扩展名（如 ".png"），如果无法推断则返回空字符串
 */
export function getExtensionFromMime(mimeType = "") {
  const normalizedMimeType = String(mimeType || "").trim().toLowerCase();
  if (!normalizedMimeType) return "";

  // 1. 精确匹配
  if (MIME_EXTENSION_MAP[normalizedMimeType]) {
    return MIME_EXTENSION_MAP[normalizedMimeType];
  }

  // 2. 前缀匹配 fallback
  for (const [prefix, fallbackExt] of Object.entries(MIME_PREFIX_FALLBACKS)) {
    if (normalizedMimeType.startsWith(prefix)) {
      return fallbackExt;
    }
  }

  return "";
}

/**
 * 解析 Data URL
 * @param {string} dataUrl - Data URL 字符串
 * @returns {{ mimeType: string, contentBase64: string } | null}
 */
export function parseDataUrl(dataUrl = "") {
  const normalizedDataUrl = String(dataUrl || "").trim();
  const matchResult = normalizedDataUrl.match(/^data:([^;,]+)?;base64,([\s\S]+)$/i);
  if (!matchResult) return null;
  return {
    mimeType: String(matchResult[1] || "application/octet-stream")
      .trim()
      .toLowerCase(),
    contentBase64: String(matchResult[2] || "").trim(),
  };
}

/**
 * 生成安全的文件名（自动添加扩展名）
 * @param {string} baseName - 基础文件名
 * @param {string} mimeType - MIME 类型
 * @param {number} index - 序号（用于生成默认名称）
 * @returns {string} 安全的文件名
 */
export function sanitizeGeneratedArtifactName(baseName = "", mimeType = "", index = 1) {
  const safeBaseName = String(baseName || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();
  const normalizedBaseName = safeBaseName || `generated_media_${index}`;
  const extension = getExtensionFromMime(mimeType);

  if (!extension) return normalizedBaseName;
  if (normalizedBaseName.toLowerCase().endsWith(extension)) {
    return normalizedBaseName;
  }
  return `${normalizedBaseName}${extension}`;
}
