/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const DEFAULT_MIME_TYPE = "application/octet-stream";

export const MIME_TYPE = Object.freeze({
  APPLICATION_OCTET_STREAM: DEFAULT_MIME_TYPE,
  APPLICATION_JSON: "application/json",
  APPLICATION_PDF: "application/pdf",
  TEXT_PLAIN: "text/plain",
  TEXT_MARKDOWN: "text/markdown",
  IMAGE_PNG: "image/png",
  IMAGE_JPEG: "image/jpeg",
  IMAGE_WEBP: "image/webp",
  IMAGE_GIF: "image/gif",
  IMAGE_BMP: "image/bmp",
  IMAGE_SVG_XML: "image/svg+xml",
  IMAGE_TIFF: "image/tiff",
  AUDIO_MPEG: "audio/mpeg",
  AUDIO_WAV: "audio/wav",
  AUDIO_MP4: "audio/mp4",
  AUDIO_AAC: "audio/aac",
  AUDIO_OGG: "audio/ogg",
  AUDIO_OPUS: "audio/opus",
  AUDIO_FLAC: "audio/flac",
  AUDIO_WEBM: "audio/webm",
  VIDEO_MP4: "video/mp4",
  VIDEO_WEBM: "video/webm",
  VIDEO_QUICKTIME: "video/quicktime",
  VIDEO_X_MSVIDEO: "video/x-msvideo",
  VIDEO_X_MATROSKA: "video/x-matroska",
  VIDEO_X_M4V: "video/x-m4v",
});

export const IMAGE_EXTENSION_TO_MIME = Object.freeze({
  ".png": MIME_TYPE.IMAGE_PNG,
  ".jpg": MIME_TYPE.IMAGE_JPEG,
  ".jpeg": MIME_TYPE.IMAGE_JPEG,
  ".webp": MIME_TYPE.IMAGE_WEBP,
  ".bmp": MIME_TYPE.IMAGE_BMP,
});

export const AUDIO_EXTENSION_TO_MIME = Object.freeze({
  ".mp3": MIME_TYPE.AUDIO_MPEG,
  ".wav": MIME_TYPE.AUDIO_WAV,
  ".m4a": MIME_TYPE.AUDIO_MP4,
  ".aac": MIME_TYPE.AUDIO_AAC,
  ".ogg": MIME_TYPE.AUDIO_OGG,
  ".opus": MIME_TYPE.AUDIO_OPUS,
  ".flac": MIME_TYPE.AUDIO_FLAC,
  ".webm": MIME_TYPE.AUDIO_WEBM,
});

export const VIDEO_EXTENSION_TO_MIME = Object.freeze({
  ".mp4": MIME_TYPE.VIDEO_MP4,
  ".webm": MIME_TYPE.VIDEO_WEBM,
  ".mov": MIME_TYPE.VIDEO_QUICKTIME,
  ".avi": MIME_TYPE.VIDEO_X_MSVIDEO,
  ".mkv": MIME_TYPE.VIDEO_X_MATROSKA,
  ".m4v": MIME_TYPE.VIDEO_X_M4V,
});

export const EXTENSION_TO_MIME = Object.freeze({
  ...IMAGE_EXTENSION_TO_MIME,
  ...AUDIO_EXTENSION_TO_MIME,
  ...VIDEO_EXTENSION_TO_MIME,
  ".gif": MIME_TYPE.IMAGE_GIF,
  ".svg": MIME_TYPE.IMAGE_SVG_XML,
  ".tiff": MIME_TYPE.IMAGE_TIFF,
  ".pdf": MIME_TYPE.APPLICATION_PDF,
  ".json": MIME_TYPE.APPLICATION_JSON,
  ".txt": MIME_TYPE.TEXT_PLAIN,
  ".md": MIME_TYPE.TEXT_MARKDOWN,
  ".markdown": MIME_TYPE.TEXT_MARKDOWN,
});

export const MIME_TO_EXTENSION = Object.freeze({
  [MIME_TYPE.IMAGE_PNG]: ".png",
  [MIME_TYPE.IMAGE_JPEG]: ".jpg",
  [MIME_TYPE.IMAGE_WEBP]: ".webp",
  [MIME_TYPE.IMAGE_GIF]: ".gif",
  [MIME_TYPE.IMAGE_BMP]: ".bmp",
  [MIME_TYPE.IMAGE_SVG_XML]: ".svg",
  [MIME_TYPE.IMAGE_TIFF]: ".tiff",
  [MIME_TYPE.VIDEO_MP4]: ".mp4",
  [MIME_TYPE.VIDEO_WEBM]: ".webm",
  [MIME_TYPE.VIDEO_QUICKTIME]: ".mov",
  [MIME_TYPE.VIDEO_X_MSVIDEO]: ".avi",
  [MIME_TYPE.VIDEO_X_MATROSKA]: ".mkv",
  [MIME_TYPE.VIDEO_X_M4V]: ".m4v",
  [MIME_TYPE.AUDIO_MPEG]: ".mp3",
  [MIME_TYPE.AUDIO_WAV]: ".wav",
  [MIME_TYPE.AUDIO_OGG]: ".ogg",
  [MIME_TYPE.AUDIO_WEBM]: ".webm",
  [MIME_TYPE.APPLICATION_PDF]: ".pdf",
  [MIME_TYPE.APPLICATION_JSON]: ".json",
  [MIME_TYPE.TEXT_PLAIN]: ".txt",
});

export const MIME_PREFIX_FALLBACK_EXTENSION = Object.freeze({
  "image/": ".png",
  "video/": ".mp4",
  "audio/": ".mp3",
});
