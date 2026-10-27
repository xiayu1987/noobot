/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

export function resolveRawAttachmentFile(fileItem) {
  if (!fileItem) return null;
  if (fileItem.raw) return fileItem.raw;
  if (fileItem.file) return fileItem.file;
  if (typeof File !== "undefined" && fileItem instanceof File) return fileItem;
  if (typeof Blob !== "undefined" && fileItem instanceof Blob) return fileItem;
  return null;
}

async function attachmentFileToBase64(file) {
  if (typeof FileReader === "undefined" && typeof file?.arrayBuffer === "function") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return globalThis.btoa(binary);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function serializeAttachments(files) {
  const output = [];
  for (const fileItem of files) {
    const rawFile = resolveRawAttachmentFile(fileItem);
    if (!rawFile) continue;
    const clientAttachmentId = text(fileItem.clientAttachmentId);
    if (!clientAttachmentId) {
      throw new TypeError("serializeAttachments requires clientAttachmentId");
    }
    output.push({
      clientAttachmentId,
      name: fileItem.name || rawFile.name || "attachment",
      mimeType: fileItem.mimeType || rawFile.type || "application/octet-stream",
      contentBase64: await attachmentFileToBase64(rawFile),
    });
  }
  return output;
}
