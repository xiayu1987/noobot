/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export async function saveFileBlob(blob, fileName) {
  const name = String(fileName || "download");
  const desktop = globalThis.noobotDesktop;
  if (desktop) {
    const result = await desktop.saveDownload({ fileName: name, bytes: await blob.arrayBuffer() });
    if (result?.canceled === true) return { canceled: true };
    if (result?.ok !== true) throw new Error(result?.error || "Desktop download failed.");
    return { canceled: false };
  }
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  try {
    anchor.href = downloadUrl;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);
  }
  return { canceled: false };
}
