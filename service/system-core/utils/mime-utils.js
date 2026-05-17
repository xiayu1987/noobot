/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  TEXT_EXTENSIONS,
} from "../constants/file-extensions.js";

function pickPreferredExtension(extensionSet, candidates = [], fallback = "") {
  for (const extension of candidates) {
    if (extensionSet.has(extension)) return extension;
  }
  return fallback;
}

const PNG_EXTENSION = pickPreferredExtension(IMAGE_EXTENSIONS, [".png"], ".png");
const JPG_EXTENSION = pickPreferredExtension(IMAGE_EXTENSIONS, [".jpg", ".jpeg"], ".jpg");
const WEBP_EXTENSION = pickPreferredExtension(IMAGE_EXTENSIONS, [".webp"], ".webp");
const BMP_EXTENSION = pickPreferredExtension(IMAGE_EXTENSIONS, [".bmp"], ".bmp");
const MP3_EXTENSION = pickPreferredExtension(AUDIO_EXTENSIONS, [".mp3"], ".mp3");
const WAV_EXTENSION = pickPreferredExtension(AUDIO_EXTENSIONS, [".wav"], ".wav");
const OGG_EXTENSION = pickPreferredExtension(AUDIO_EXTENSIONS, [".ogg"], ".ogg");
const AUDIO_WEBM_EXTENSION = pickPreferredExtension(AUDIO_EXTENSIONS, [".webm"], ".webm");
const TXT_EXTENSION = pickPreferredExtension(TEXT_EXTENSIONS, [".txt"], ".txt");

/**
 * MIME 类型到文件扩展名的映射表
 */
const MIME_EXTENSION_MAP = {
  "image/png": PNG_EXTENSION,
  "image/jpeg": JPG_EXTENSION,
  "image/webp": WEBP_EXTENSION,
  "image/gif": ".gif",
  "image/bmp": BMP_EXTENSION,
  "image/tiff": ".tiff",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "video/x-m4v": ".m4v",
  "audio/mpeg": MP3_EXTENSION,
  "audio/wav": WAV_EXTENSION,
  "audio/ogg": OGG_EXTENSION,
  "audio/webm": AUDIO_WEBM_EXTENSION,
  "application/pdf": ".pdf",
  "application/json": ".json",
  "text/plain": TXT_EXTENSION,
};

/**
 * 根据 MIME 类型前缀推断默认扩展名
 */
const MIME_PREFIX_FALLBACKS = {
  "image/": PNG_EXTENSION,
  "video/": ".mp4",
  "audio/": MP3_EXTENSION,
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
