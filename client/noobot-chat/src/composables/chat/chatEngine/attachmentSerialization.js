/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function resolveRawAttachmentFile(fileItem) {
  if (!fileItem) return null;
  if (fileItem.raw) return fileItem.raw;
  if (fileItem.file) return fileItem.file;
  if (typeof File !== "undefined" && fileItem instanceof File) return fileItem;
  if (typeof Blob !== "undefined" && fileItem instanceof Blob) return fileItem;
  return null;
}

export function attachmentFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function serializeAttachments(files = []) {
  const output = [];
  for (const fileItem of Array.isArray(files) ? files : []) {
    const rawFile = resolveRawAttachmentFile(fileItem);
    if (!rawFile) continue;
    output.push({
      name: fileItem.name || rawFile.name || "attachment",
      mimeType: fileItem.mimeType || rawFile.type || "application/octet-stream",
      contentBase64: await attachmentFileToBase64(rawFile),
    });
  }
  return output;
}
