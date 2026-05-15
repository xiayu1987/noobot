/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Attachment content block builder for different provider formats.
 */

/**
 * Build a content block from an attachment payload.
 * @param {object} params
 * @returns {object}
 */
export function buildAttachmentContentBlock({
  attachment,
  providerFormat = "openai",
} = {}) {
  const { type, mimeType, data } = attachment || {};
  if (!type || !data) return null;

  if (providerFormat === "dashscope") {
    return buildDashscopeAttachmentBlock({ type, mimeType, data });
  }
  return buildOpenAIAttachmentBlock({ type, mimeType, data });
}

function buildDashscopeAttachmentBlock({ type, mimeType, data }) {
  const mediaType = type.split("/")[0];
  if (mediaType === "image") {
    const normalizedImageUrl = data.startsWith("data:")
      ? data
      : `data:${mimeType};base64,${data}`;
    return {
      type: "image_url",
      image_url: {
        url: normalizedImageUrl,
      },
    };
  }

  if (mediaType === "audio") {
    const base64 = data.startsWith("data:") ? data.split(",")[1] || "" : data;
    const normalizedDataUrl = String(data || "").startsWith("data:")
      ? String(data || "")
      : `data:${mimeType};base64,${base64}`;
    return {
      type: "input_audio",
      input_audio: {
        data: normalizedDataUrl,
        format: normalizeAudioFormat(mimeType),
      },
    };
  }

  if (mediaType === "video") {
    const url = data.startsWith("data:")
      ? data
      : `data:${mimeType};base64,${data}`;
    return { type: "video", video: url };
  }

  return null;
}

function buildOpenAIAttachmentBlock({ type, mimeType, data }) {
  const mediaType = type.split("/")[0];
  if (mediaType === "image") {
    const normalizedImageUrl = data.startsWith("data:")
      ? data
      : `data:${mimeType};base64,${data}`;
    return {
      type: "image_url",
      image_url: {
        url: normalizedImageUrl,
      },
    };
  }

  if (mediaType === "audio") {
    const base64 = data.startsWith("data:") ? data.split(",")[1] || "" : data;
    return {
      type: "input_audio",
      input_audio: { data: base64, format: normalizeAudioFormat(mimeType) },
    };
  }

  if (mediaType === "video") {
    const url = data.startsWith("data:")
      ? data
      : `data:${mimeType};base64,${data}`;
    return { type: "video_url", video_url: { url } };
  }

  return null;
}

function normalizeAudioFormat(mimeType) {
  const subtype = String(mimeType || "")
    .split("/")[1]
    ?.trim()
    .toLowerCase();
  if (!subtype) return "mp3";
  if (subtype === "wav" || subtype === "x-wav") return "wav";
  if (subtype === "mp3" || subtype === "mpeg" || subtype === "x-mpeg") {
    return "mp3";
  }
  return "mp3";
}

/**
 * Normalize model output content to a string.
 * @param {string|Array<object>|object} content
 * @returns {string}
 */
export function normalizeModelOutputContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text") return part.text || "";
        if (part?.text) return part.text;
        return "";
      })
      .join("");
  }
  if (content?.text) return content.text;
  return String(content || "");
}
