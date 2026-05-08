/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MIME_EXTENSION_MAP } from "../constants.js";

export function normalizeAiTextContent(aiContent) {
  if (typeof aiContent === "string") return String(aiContent || "");
  if (!Array.isArray(aiContent)) return String(aiContent || "");
  const textParts = aiContent
    .map((contentPart) => {
      if (!contentPart || typeof contentPart !== "object") return "";
      if (typeof contentPart?.text === "string") return contentPart.text;
      if (typeof contentPart?.content === "string") return contentPart.content;
      return "";
    })
    .filter(Boolean);
  return textParts.join("\n");
}

export function sanitizeGeneratedArtifactName(baseName = "", mimeType = "", index = 1) {
  const safeBaseName = String(baseName || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();
  const normalizedBaseName = safeBaseName || `generated_media_${index}`;
  const normalizedMimeType = String(mimeType || "").trim().toLowerCase();
  const extension =
    MIME_EXTENSION_MAP[normalizedMimeType] ||
    (normalizedMimeType.startsWith("image/") ? ".png" : "") ||
    (normalizedMimeType.startsWith("video/") ? ".mp4" : "");
  if (!extension) return normalizedBaseName;
  if (normalizedBaseName.toLowerCase().endsWith(extension)) {
    return normalizedBaseName;
  }
  return `${normalizedBaseName}${extension}`;
}

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
