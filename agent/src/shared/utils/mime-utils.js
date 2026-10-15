/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  DEFAULT_MIME_TYPE,
  MIME_PREFIX_FALLBACK_EXTENSION,
  MIME_TO_EXTENSION,
} from "@noobot/attachment-protocol/mime";
import { text } from "@noobot/shared/value";

const MIME_EXTENSION_MAP = MIME_TO_EXTENSION;

const MIME_PREFIX_FALLBACKS = MIME_PREFIX_FALLBACK_EXTENSION;

export function getMimeExtensionMap() {
  return { ...MIME_EXTENSION_MAP };
}

export function getExtensionFromMime(mimeType = "") {
  const normalizedMimeType = text(mimeType).toLowerCase();
  if (!normalizedMimeType) return "";

  if (MIME_EXTENSION_MAP[normalizedMimeType]) {
    return MIME_EXTENSION_MAP[normalizedMimeType];
  }

  for (const [prefix, fallbackExt] of Object.entries(MIME_PREFIX_FALLBACKS)) {
    if (normalizedMimeType.startsWith(prefix)) {
      return fallbackExt;
    }
  }

  return "";
}

export function parseDataUrl(dataUrl = "") {
  const normalizedDataUrl = text(dataUrl);
  const matchResult = normalizedDataUrl.match(/^data:([^;,]+)?;base64,([\s\S]+)$/i);
  if (!matchResult) return null;
  return {
    mimeType: String(matchResult[1] || DEFAULT_MIME_TYPE)
      .trim()
      .toLowerCase(),
    contentBase64: text(matchResult[2]),
  };
}

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
