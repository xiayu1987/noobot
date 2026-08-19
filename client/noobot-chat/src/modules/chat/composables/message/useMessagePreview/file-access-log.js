/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createFileAccessTraceId } from "./path-utils.js";

export function logFileAccess(event, payload = {}) {
  try {
    const entry = {
      layer: "client.messagePreview",
      event,
      ...payload,
    };
    globalThis?.noobotDesktop?.logFileAccess?.(entry).catch?.((error) => {
      console.warn(`[noobot:file-access] desktop log failed for ${event}`, error);
    });
  } catch (error) {
    console.warn(`[noobot:file-access] log construction failed for ${event}`, error);
  }
}

export async function triggerBlobDownload(blob, fileName) {
  const traceId = createFileAccessTraceId("save");
  logFileAccess("blobDownload.start", {
    traceId,
    fileName: String(fileName || "download"),
    size: Number(blob?.size || 0),
    type: String(blob?.type || ""),
  });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = String(fileName || "download");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);
  logFileAccess("blobDownload.done", { traceId, fileName: String(fileName || "download") });
}
