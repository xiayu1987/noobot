/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildAttachmentUrl,
  resolveAttachmentId,
  resolveAttachmentSessionId,
  resolveAttachmentSource,
} from "./chatApi";

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstString(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function firstKnownSize(...values) {
  for (const value of values) {
    const size = Number(value);
    if (Number.isFinite(size) && size >= 0) return size;
  }
  return null;
}

export function resolveBaseName(filePath = "") {
  const normalized = String(filePath || "").trim().replaceAll("\\", "/");
  if (!normalized) return "";
  const parts = normalized.split("/");
  return String(parts[parts.length - 1] || "").trim();
}

export function resolveAttachmentAccessMeta(attachmentItem = {}, { userId = "" } = {}) {
  const attachmentId = resolveAttachmentId(attachmentItem);
  const sessionId = resolveAttachmentSessionId(attachmentItem);
  const attachmentSource = resolveAttachmentSource(attachmentItem);
  const existingUrl = firstString(
    attachmentItem?.previewUrl,
    attachmentItem?.url,
    attachmentItem?.downloadUrl,
  );
  const url = existingUrl ||
    (attachmentId
      ? buildAttachmentUrl({
          userId,
          attachmentId,
          sessionId,
          attachmentSource,
        })
      : "");
  return {
    attachmentId,
    sessionId,
    attachmentSource,
    url,
  };
}

export function resolveParsedResultAccessMeta(
  attachmentItem = {},
  { userId = "", defaultAttachmentSource = "model" } = {},
) {
  const parsedResult = isPlainObject(attachmentItem?.parsedResult)
    ? attachmentItem.parsedResult
    : {};
  const attachmentId = firstString(
    parsedResult?.attachmentId,
    parsedResult?.id,
    attachmentItem?.parsedResultAttachmentId,
  );
  const sessionId = firstString(
    parsedResult?.sessionId,
    parsedResult?.session_id,
    attachmentItem?.parsedResultSessionId,
    resolveAttachmentSessionId(attachmentItem),
  );
  const attachmentSource = firstString(
    parsedResult?.attachmentSource,
    parsedResult?.attachment_source,
    parsedResult?.source,
    attachmentItem?.parsedResultAttachmentSource,
    defaultAttachmentSource,
  );
  const path = firstString(parsedResult?.path, attachmentItem?.parsedResultPath);
  const relativePath = firstString(
    parsedResult?.relativePath,
    parsedResult?.relative_path,
    attachmentItem?.parsedResultRelativePath,
  );
  const existingUrl = firstString(
    attachmentItem?.parsedResultUrl,
    parsedResult?.url,
    parsedResult?.previewUrl,
    parsedResult?.downloadUrl,
  );
  const url = existingUrl ||
    (attachmentId
      ? buildAttachmentUrl({
          userId,
          attachmentId,
          sessionId,
          attachmentSource,
        })
      : "");
  const name = firstString(
    attachmentItem?.parsedResultName,
    parsedResult?.name,
    parsedResult?.fileName,
    parsedResult?.filename,
    resolveBaseName(relativePath),
    resolveBaseName(path),
  );
  const mimeType = firstString(
    parsedResult?.mimeType,
    parsedResult?.type,
    parsedResult?.mime,
    "text/markdown",
  );
  const size = firstKnownSize(
    parsedResult?.size,
    parsedResult?.bytes,
    attachmentItem?.parsedResultSize,
    attachmentItem?.parsedResultBytes,
  );

  return {
    raw: parsedResult,
    attachmentId,
    sessionId,
    attachmentSource,
    path,
    relativePath,
    url,
    name,
    mimeType,
    size,
    hasIdentity: Boolean(attachmentId || url),
  };
}

export function buildParsedResultPreviewItem(attachmentItem = {}, options = {}) {
  const parsedResult = resolveParsedResultAccessMeta(attachmentItem, options);
  return {
    ...parsedResult.raw,
    ...(parsedResult.attachmentId ? { attachmentId: parsedResult.attachmentId } : {}),
    ...(parsedResult.sessionId ? { sessionId: parsedResult.sessionId } : {}),
    ...(parsedResult.attachmentSource ? { attachmentSource: parsedResult.attachmentSource } : {}),
    ...(parsedResult.path ? { path: parsedResult.path } : {}),
    ...(parsedResult.relativePath ? { relativePath: parsedResult.relativePath } : {}),
    name: parsedResult.name || String(attachmentItem?.name || "").trim(),
    mimeType: parsedResult.mimeType,
    ...(parsedResult.size !== null ? { size: parsedResult.size } : {}),
  };
}
