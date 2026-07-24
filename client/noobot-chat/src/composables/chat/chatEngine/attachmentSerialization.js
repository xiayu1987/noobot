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

export async function attachmentFileToBase64(file) {
  // FileReader is browser-only. Blob/File also expose arrayBuffer(), which
  // keeps serialization usable in workers, SSR and the Node test runtime.
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

export async function serializeAttachments(files = []) {
  const output = [];
  for (const fileItem of Array.isArray(files) ? files : []) {
    const rawFile = resolveRawAttachmentFile(fileItem);
    if (!rawFile) continue;
    output.push({
      ...((fileItem.clientAttachmentId || fileItem.draftAttachmentId)
        ? { clientAttachmentId: String(fileItem.clientAttachmentId || fileItem.draftAttachmentId) }
        : {}),
      name: fileItem.name || rawFile.name || "attachment",
      mimeType: fileItem.mimeType || rawFile.type || "application/octet-stream",
      contentBase64: await attachmentFileToBase64(rawFile),
    });
  }
  return output;
}
