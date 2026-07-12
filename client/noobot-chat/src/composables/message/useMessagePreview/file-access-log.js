/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createFileAccessTraceId } from "./path-utils";

export function logFileAccess(event, payload = {}) {
  try {
    const entry = {
      layer: "client.messagePreview",
      event,
      ...payload,
    };
    window?.noobotDesktop?.logFileAccess?.(entry).catch?.(() => {});
  } catch {}
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
