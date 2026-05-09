/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Multimodal attachment handling for model providers.
 */

function _normalizeProviderFormat(modelSpec = {}) {
  const normalizedFormat = String(modelSpec?.format || "")
    .trim()
    .toLowerCase();
  if (normalizedFormat === "dashscope") return "dashscope";
  return "openai_compatible";
}

function _normalizeAudioFormatFromMimeType(mimeType = "", fallbackFormat = "") {
  const normalizedFallbackFormat = String(fallbackFormat || "")
    .trim()
    .toLowerCase();
  if (normalizedFallbackFormat === "mp3" || normalizedFallbackFormat === "wav") {
    return normalizedFallbackFormat;
  }

  const normalizedMimeType = String(mimeType || "").trim().toLowerCase();
  const subtype = normalizedMimeType.split("/")[1] || "";
  const normalizedSubtype = subtype.split(";")[0].trim();

  if (normalizedSubtype === "mpeg" || normalizedSubtype === "mp3") return "mp3";
  if (
    normalizedSubtype === "wav" ||
    normalizedSubtype === "x-wav" ||
    normalizedSubtype === "wave"
  ) {
    return "wav";
  }
  if (normalizedMimeType.includes("wav")) return "wav";
  return "mp3";
}

function _resolveDefaultMimeTypeByMediaType(mediaType = "") {
  const normalizedMediaType = String(mediaType || "").trim().toLowerCase();
  if (normalizedMediaType === "image") return "image/png";
  if (normalizedMediaType === "audio") return "audio/mpeg";
  if (normalizedMediaType === "video") return "video/mp4";
  return "application/octet-stream";
}

function _normalizeMimeTypeByAttachment(attachment = {}) {
  const explicitMimeType = String(attachment?.mimeType || "").trim().toLowerCase();
  if (explicitMimeType) return explicitMimeType;
  return _resolveDefaultMimeTypeByMediaType(attachment?.mediaType);
}

function _extractBase64FromDataUrl(dataUrl = "") {
  const normalizedDataUrl = String(dataUrl || "").trim();
  const matchResult = normalizedDataUrl.match(/^data:[^;]+;base64,([\s\S]+)$/i);
  if (!matchResult) return "";
  return String(matchResult[1] || "").trim();
}

function _buildDataUrlFromAttachment(attachment = {}) {
  const explicitDataUrl = String(attachment?.dataUrl || "").trim();
  if (explicitDataUrl) return explicitDataUrl;
  const mimeType = _normalizeMimeTypeByAttachment(attachment);
  const dataBase64 = String(attachment?.dataBase64 || "").trim();
  if (!dataBase64) return "";
  return `data:${mimeType};base64,${dataBase64}`;
}

function _buildAttachmentContentBlockForProvider({
  providerFormat = "openai_compatible",
  attachment = {},
}) {
  const mediaType = String(attachment?.mediaType || "").trim().toLowerCase();
  if (!mediaType) return null;
  const dataUrl = _buildDataUrlFromAttachment(attachment);
  if (!dataUrl) return null;
  const mimeType = _normalizeMimeTypeByAttachment(attachment);
  const payloadBase64 =
    String(attachment?.dataBase64 || "").trim() || _extractBase64FromDataUrl(dataUrl);

  const dashscopeBuilderMap = {
    image: () => ({ type: "image_url", image_url: { url: dataUrl } }),
    audio: () => ({
      type: "input_audio",
      input_audio: {
        data: dataUrl,
        format: _normalizeAudioFormatFromMimeType(
          mimeType,
          attachment?.audioFormat,
        ),
      },
    }),
    video: () => ({ type: "video_url", video_url: { url: dataUrl } }),
  };

  if (providerFormat === "dashscope") {
    const dashscopeBuilder = dashscopeBuilderMap[mediaType];
    if (typeof dashscopeBuilder === "function") return dashscopeBuilder();
    return null;
  }

  if (mediaType === "image") {
    return { type: "image_url", image_url: { url: dataUrl } };
  }
  if (mediaType === "audio") {
    if (!payloadBase64) return null;
    return {
      type: "input_audio",
      input_audio: {
        format: _normalizeAudioFormatFromMimeType(mimeType),
        data: payloadBase64,
      },
    };
  }
  if (mediaType === "video") {
    if (!payloadBase64) return null;
    return {
      type: "video",
      video: {
        mime_type: mimeType,
        data: payloadBase64,
      },
    };
  }
  return null;
}

export function normalizeProviderFormat(modelSpec = {}) {
  return _normalizeProviderFormat(modelSpec);
}

export function buildAttachmentContentBlock(attachment, providerFormat) {
  return _buildAttachmentContentBlockForProvider({
    providerFormat,
    attachment,
  });
}

export function normalizeModelOutputContent(content) {
  return typeof content === "string" ? content : JSON.stringify(content || "");
}
