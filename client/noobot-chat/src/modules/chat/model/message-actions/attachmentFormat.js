/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  attachmentIdentityKey,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";

export function isImageMime(mimeType = "") {
  return String(mimeType || "").toLowerCase().startsWith("image/");
}

export function attachmentName(item = {}) {
  return String(item?.name || item?.filename || item?.fileName || item?.path || item?.relativePath || "附件").trim();
}

export function attachmentMime(item = {}) {
  return String(item?.mimeType || item?.type || item?.mime || "application/octet-stream").trim();
}

export function formatAttachmentSize(size = 0) {
  const value = Number(size || 0);
  if (!Number.isFinite(value) || value <= 0) return "未知大小";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function attachmentTypeLabel(attachment = {}) {
  const mime = attachmentMime(attachment).toLowerCase();
  if (mime.startsWith("image/")) return "图片";
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("zip") || mime.includes("compressed")) return "压缩包";
  if (mime.includes("text") || mime.includes("json") || mime.includes("markdown")) return "文本";
  return "文件";
}

export function attachmentIcon(attachment = {}) {
  const mime = attachmentMime(attachment).toLowerCase();
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("zip") || mime.includes("compressed")) return "ZIP";
  if (mime.includes("json")) return "{}";
  if (mime.includes("text") || mime.includes("markdown")) return "TXT";
  return "FILE";
}

export function attachmentKey(item = {}) {
  return attachmentIdentityKey(projectAttachmentIdentity(item));
}

export function cloneHistoryAttachment(item = {}) {
  const cloned = { ...item };
  delete cloned.previewUrl;
  delete cloned.raw;
  delete cloned.file;
  return cloned;
}

export function rawFileKey(file = {}) {
  return [
    String(file?.name || "").trim(),
    String(file?.size || 0),
    String(file?.lastModified || 0),
    String(file?.type || "").trim(),
  ].join("|");
}

export function createClientAttachmentId() {
  return globalThis?.crypto?.randomUUID?.() || `client-attachment:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}
