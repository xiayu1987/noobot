/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_MULTIMODAL_MODALITY } from "./model-capabilities.js";

export const MODEL_INPUT_PROCESSING_KIND = Object.freeze({
  DIRECT_TEXT: "direct_text",
  MULTIMODAL: "multimodal",
});

const DIRECT_TEXT_APPLICATION_MIME_TYPES = new Set([
  "application/csv",
  "application/json",
  "application/javascript",
  "application/ld+json",
  "application/sql",
  "application/toml",
  "application/x-httpd-php",
  "application/x-javascript",
  "application/x-ndjson",
  "application/x-sh",
  "application/x-yaml",
  "application/xml",
  "application/yaml",
]);

function normalizeMimeType(value = "") {
  return String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function isDirectTextMimeType(mimeType = "") {
  return (
    mimeType.startsWith("text/") ||
    DIRECT_TEXT_APPLICATION_MIME_TYPES.has(mimeType) ||
    (mimeType.startsWith("application/") &&
      (mimeType.endsWith("+json") || mimeType.endsWith("+xml") || mimeType.endsWith("+yaml")))
  );
}

export function classifyModelInputProcessing(mimeType = "") {
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (normalizedMimeType.startsWith("image/")) {
    return Object.freeze({
      kind: MODEL_INPUT_PROCESSING_KIND.MULTIMODAL,
      mimeType: normalizedMimeType,
      modality: MODEL_MULTIMODAL_MODALITY.IMAGE,
    });
  }
  if (isDirectTextMimeType(normalizedMimeType)) {
    return Object.freeze({
      kind: MODEL_INPUT_PROCESSING_KIND.DIRECT_TEXT,
      mimeType: normalizedMimeType,
      modality: null,
    });
  }
  const modality = normalizedMimeType.startsWith("audio/")
    ? MODEL_MULTIMODAL_MODALITY.AUDIO
    : normalizedMimeType.startsWith("video/")
      ? MODEL_MULTIMODAL_MODALITY.VIDEO
      : MODEL_MULTIMODAL_MODALITY.DOCUMENT;
  return Object.freeze({
    kind: MODEL_INPUT_PROCESSING_KIND.MULTIMODAL,
    mimeType: normalizedMimeType,
    modality,
  });
}
