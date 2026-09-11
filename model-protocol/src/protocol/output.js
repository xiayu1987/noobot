/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function normalizeText(value) {
  return String(value || "").trim();
}

function isSupportedArtifactUrl(value) {
  const url = normalizeText(value);
  return /^https?:\/\//i.test(url) || /^data:[^;,]+;base64,[\s\S]+$/i.test(url);
}

export function isModelOutputArtifactContentBlock(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const type = normalizeText(value.type).toLowerCase();
  if (!type.includes("image") && !type.includes("video")) return false;

  const sourceType = normalizeText(value.source?.type).toLowerCase();
  return Boolean(
    isSupportedArtifactUrl(value.image_url?.url) ||
    isSupportedArtifactUrl(value.video_url?.url) ||
    isSupportedArtifactUrl(value.url) ||
    (sourceType === "base64" && normalizeText(value.source?.data)),
  );
}

export function hasUsableModelChatOutput(output = {}) {
  return Boolean(
    normalizeText(output?.text) ||
    (Array.isArray(output?.toolCalls) && output.toolCalls.length > 0) ||
    (Array.isArray(output?.content) && output.content.some(isModelOutputArtifactContentBlock)),
  );
}
