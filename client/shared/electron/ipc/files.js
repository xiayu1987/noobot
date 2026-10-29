/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import { clientPathDirname, joinClientPath } from "../../path-resolver.js";
import { text } from "@noobot/shared/value";

function sanitizeDownloadFileName(fileName = "") {
  const value = text(fileName) || "download";
  return (
    value
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\.+$/g, "_")
      .slice(0, 180) || "download"
  );
}

function normalizeDownloadBytes(bytes) {
  if (!(bytes instanceof ArrayBuffer))
    throw new TypeError("Download bytes must be an ArrayBuffer.");
  return Buffer.from(bytes);
}

function sanitizeFileAccessLogPayload(payload = {}) {
  const input =
    payload && typeof payload === "object" ? payload : { message: String(payload || "") };
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      output[key] = value;
      continue;
    }
    if (value instanceof Error) {
      output[key] = value.message;
      continue;
    }
    try {
      output[key] = JSON.stringify(value).slice(0, 1000);
    } catch {
      output[key] = String(value).slice(0, 1000);
    }
  }
  return output;
}

export function registerFileIpcHandlers({
  app,
  dialog,
  ipcMain,
  appendDesktopLog = () => {},
  getMainWindow = () => null,
} = {}) {
  ipcMain.handle("noobot:save-download", async (_event, { fileName = "download", bytes } = {}) => {
    const buffer = normalizeDownloadBytes(bytes);
    const defaultPath = joinClientPath(
      app.getPath("downloads"),
      sanitizeDownloadFileName(fileName),
    );
    const result = await dialog.showSaveDialog(getMainWindow() || undefined, {
      defaultPath,
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fs.promises.mkdir(clientPathDirname(result.filePath), { recursive: true });
    await fs.promises.writeFile(result.filePath, buffer);
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle("noobot:file-access-log", (_event, payload = {}) => {
    appendDesktopLog(
      `[noobot:file-access] ${JSON.stringify(sanitizeFileAccessLogPayload(payload))}`,
    );
    return { ok: true };
  });
}
