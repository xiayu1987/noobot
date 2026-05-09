/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const DEFAULT_ATTACHMENT_SESSION_ID = "unknown_session";
export const DEFAULT_ATTACHMENT_SOURCE = "user";
export const ATTACHMENT_SOURCES = new Set(["user", "model", "email", "subtask"]);

export const DEFAULT_MIME_TYPE = "application/octet-stream";

export const MIME_TO_EXTENSION = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "video/x-msvideo": ".avi",
  "video/x-matroska": ".mkv",
  "video/x-m4v": ".m4v",
};

export const MAX_EXTENSION_LENGTH = 20;
