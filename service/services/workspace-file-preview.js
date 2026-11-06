/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { open } from "node:fs/promises";
import { describeFilePreview, FILE_PREVIEW_URL_TYPES } from "@noobot/attachment-protocol/preview";

async function readBoundedText(handle, size, maxBytes) {
  const buffer = Buffer.alloc(Math.min(size + 1, maxBytes + 1));
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
}

function decodeText(buffer) {
  if (buffer.includes(0)) return { isText: false, content: "" };
  try {
    return {
      isText: true,
      content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer),
    };
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return { isText: false, content: "" };
  }
}

export async function readWorkspaceFilePreview(absolutePath, name) {
  const handle = await open(absolutePath, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile())
      throw Object.assign(new Error("Workspace path is not a file"), { statusCode: 400 });
    let preview = describeFilePreview({ name, size: stats.size });
    if (FILE_PREVIEW_URL_TYPES.has(preview.type) || preview.type === "office" || preview.overLimit)
      return { size: stats.size, isText: null, content: "", preview };
    const buffer = await readBoundedText(handle, stats.size, preview.maxBytes);
    if (buffer.length > preview.maxBytes)
      return {
        size: stats.size,
        isText: null,
        content: "",
        preview: { ...preview, overLimit: true },
      };
    const decoded = decodeText(buffer);
    preview = describeFilePreview({ name, size: stats.size, isText: decoded.isText });
    return { size: stats.size, ...decoded, preview };
  } finally {
    await handle.close();
  }
}
