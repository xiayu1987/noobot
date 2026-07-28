/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function summarizeDebugAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return { kind: attachments === undefined ? "undefined" : "non-array", count: 0, items: [] };
  }
  return {
    kind: "array",
    count: attachments.length,
    items: attachments.slice(0, 8).map((attachment = {}) => ({
      id: String(attachment.id || attachment.fileId || attachment.attachmentId || ""),
      name: String(attachment.name || attachment.fileName || attachment.filename || ""),
      type: String(attachment.type || attachment.mimeType || attachment.mime || ""),
      size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : undefined,
      url: attachment.url ? "present" : "",
    })),
  };
}

export function readSelectedModelValue(modelConfig = "") {
  if (typeof modelConfig === "string") return modelConfig.trim();
  if (!modelConfig || typeof modelConfig !== "object" || Array.isArray(modelConfig)) return "";
  return String(
    modelConfig?.value || modelConfig?.alias || modelConfig?.key || modelConfig?.model || "",
  ).trim();
}
