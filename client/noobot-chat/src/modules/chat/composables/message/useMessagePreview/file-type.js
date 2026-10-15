/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveParsedResultAccessMeta } from "../../../../../infrastructure/api/attachments/attachmentAccess.js";
import {
  MARKDOWN_EXTS,
  IMAGE_EXTS,
  TEXT_PREVIEW_EXTS,
  OFFICE_EXTS,
  MARKDOWN_MIMES,
  NON_IMAGE_PREVIEW_MAX_BYTES,
} from "./constants.js";
import { text } from "@noobot/shared/value";

function getFileExtension(fileName = "") {
  const normalized = text(fileName).toLowerCase();
  const idx = normalized.lastIndexOf(".");
  return idx < 0 ? "" : normalized.slice(idx + 1);
}

export function isMarkdownFile(fileName = "") {
  return MARKDOWN_EXTS.has(getFileExtension(fileName));
}

export function isImageFile(fileName = "") {
  return IMAGE_EXTS.has(getFileExtension(fileName));
}

export function isTextPreviewFile(fileName = "") {
  const normalized = text(fileName).toLowerCase();
  if (!normalized) return false;
  if (isMarkdownFile(normalized)) return true;
  if (["dockerfile", "makefile", "license", "readme", "changelog"].includes(normalized))
    return true;
  return TEXT_PREVIEW_EXTS.has(getFileExtension(normalized));
}

export function isOfficeFile(fileName = "") {
  return OFFICE_EXTS.has(getFileExtension(fileName));
}

export function isMarkdownMime(mimeType = "", fileName = "") {
  const mime = text(mimeType).toLowerCase();
  const name = text(fileName).toLowerCase();
  return (
    MARKDOWN_MIMES.has(mime) ||
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    name.endsWith(".mdx")
  );
}

export function isTextPreviewMime(mimeType = "") {
  const mime = text(mimeType).toLowerCase();
  if (!mime) return false;
  return (
    mime.startsWith("text/") ||
    [
      "json",
      "xml",
      "yaml",
      "yml",
      "toml",
      "csv",
      "javascript",
      "ecmascript",
      "typescript",
      "x-sh",
      "shellscript",
      "sql",
      "graphql",
      "x-www-form-urlencoded",
    ].some((kw) => mime.includes(kw))
  );
}

export function isImagePreviewType(mimeType = "", fileName = "", isImageMimeChecker = () => false) {
  const mime = text(mimeType).toLowerCase();
  return Boolean(isImageMimeChecker(mime)) || mime.startsWith("image/") || isImageFile(fileName);
}

function resolveKnownFileSize(fileItem = {}) {
  for (const value of [
    fileItem?.size,
    fileItem?.fileSize,
    fileItem?.bytes,
    fileItem?.contentLength,
    fileItem?.content_length,
  ]) {
    const size = Number(value);
    if (Number.isFinite(size) && size >= 0) return size;
  }
  return null;
}

export function isNonImagePreviewOverSizeLimit({
  fileItem = {},
  mimeType = "",
  fileName = "",
  isImageMimeChecker = () => false,
} = {}) {
  if (isImagePreviewType(mimeType, fileName, isImageMimeChecker)) return false;
  const size = resolveKnownFileSize(fileItem);
  return size !== null && size > NON_IMAGE_PREVIEW_MAX_BYTES;
}

export function isAudioPreviewMime(mimeType = "") {
  const mime = text(mimeType).toLowerCase();
  return mime.startsWith("audio/");
}

export function isOfficeMime(mimeType = "") {
  const mime = text(mimeType).toLowerCase();
  return (
    mime.includes("msword") ||
    mime.includes("officedocument") ||
    mime.includes("ms-excel") ||
    mime.includes("ms-powerpoint") ||
    mime.includes("opendocument") ||
    mime.includes("rtf")
  );
}

export function hasParsedResult(attachmentItem = {}) {
  return Boolean(resolveParsedResultAccessMeta(attachmentItem));
}
