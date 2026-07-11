/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { app, dialog, ipcMain } from "electron";
import fs from "node:fs";
import { clientPathBasename, clientPathDirname, isAbsoluteClientPath, joinClientPath, normalizeClientPath } from "../path-resolver.js";

export function registerFileIpcHandlers({ appendDesktopLog = () => {}, getMainWindow = () => null } = {}) {
  function sanitizeDownloadFileName(fileName = "") {
    const value = String(fileName || "download").trim() || "download";
    return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\.+$/g, "_").slice(0, 180) || "download";
  }

  function normalizeDownloadBytes(bytes) {
    if (!bytes) throw new Error("Missing download content.");
    if (Buffer.isBuffer(bytes)) return bytes;
    if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
    if (ArrayBuffer.isView(bytes)) {
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    if (Array.isArray(bytes)) return Buffer.from(bytes);
    if (typeof bytes === "object" && bytes?.type === "Buffer" && Array.isArray(bytes?.data)) {
      return Buffer.from(bytes.data);
    }
    throw new Error("Unsupported download content.");
  }

  function sanitizeFileAccessLogPayload(payload = {}) {
    const input = payload && typeof payload === "object" ? payload : { message: String(payload || "") };
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

  function maskHostPath(pathValue = "") {
    const normalized = normalizeClientPath(String(pathValue || "").trim());
    if (!normalized) return "";
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length <= 2) return normalized;
    return `${parts[0]}/.../${parts.at(-1)}`;
  }

  function logHostFileAccess(event, payload = {}) {
    appendDesktopLog(`[noobot:file-access] ${JSON.stringify(sanitizeFileAccessLogPayload({
      layer: "electron.main",
      event,
      channel: "desktop-host-ipc",
      ...payload,
    }))}`);
  }

  async function resolveHostFile(pathValue = "") {
    const targetPath = String(pathValue || "").trim();
    if (!targetPath) {
      const error = new Error("Missing host file path.");
      error.code = "missing_path";
      throw error;
    }
    if (!isAbsoluteClientPath(targetPath)) {
      const error = new Error("Host file path must be absolute.");
      error.code = "not_absolute";
      throw error;
    }
    const stats = await fs.promises.stat(targetPath);
    if (!stats.isFile()) {
      const error = new Error("Host path is not a file.");
      error.code = "not_file";
      throw error;
    }
    return { targetPath, stats };
  }

  ipcMain.handle("noobot:save-download", async (_event, { fileName = "download", bytes } = {}) => {
    const buffer = normalizeDownloadBytes(bytes);
    const defaultPath = joinClientPath(app.getPath("downloads"), sanitizeDownloadFileName(fileName));
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
    appendDesktopLog(`[noobot:file-access] ${JSON.stringify(sanitizeFileAccessLogPayload(payload))}`);
    return { ok: true };
  });

  ipcMain.handle("noobot:read-host-file", async (_event, { path: pathValue = "", traceId = "" } = {}) => {
    const hostPath = String(pathValue || "").trim();
    try {
      logHostFileAccess("host.read.request", { traceId, hostPath: maskHostPath(hostPath), hasPath: Boolean(hostPath) });
      const { targetPath, stats } = await resolveHostFile(hostPath);
      const buffer = await fs.promises.readFile(targetPath);
      const isText = !buffer.includes(0);
      const content = isText ? buffer.toString("utf8") : "";
      logHostFileAccess("host.read.response", { traceId, hostPath: maskHostPath(targetPath), isText, size: stats.size });
      return { ok: true, path: targetPath, fileName: clientPathBasename(targetPath), isText, size: stats.size, content };
    } catch (error) {
      logHostFileAccess("host.read.failed", { traceId, hostPath: maskHostPath(hostPath), errorCode: error?.code || "host_read_failed", error: error?.message || String(error) });
      return { ok: false, errorCode: error?.code || "host_read_failed", error: error?.message || String(error) };
    }
  });

  ipcMain.handle("noobot:download-host-file", async (_event, { path: pathValue = "", traceId = "" } = {}) => {
    const hostPath = String(pathValue || "").trim();
    try {
      logHostFileAccess("host.download.request", { traceId, hostPath: maskHostPath(hostPath), hasPath: Boolean(hostPath) });
      const { targetPath, stats } = await resolveHostFile(hostPath);
      const fileName = clientPathBasename(targetPath);
      const defaultPath = joinClientPath(app.getPath("downloads"), sanitizeDownloadFileName(fileName));
      const result = await dialog.showSaveDialog(getMainWindow() || undefined, {
        defaultPath,
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (result.canceled || !result.filePath) {
        logHostFileAccess("host.download.response", { traceId, hostPath: maskHostPath(targetPath), canceled: true, size: stats.size });
        return { ok: false, canceled: true, fileName, size: stats.size };
      }
      await fs.promises.mkdir(clientPathDirname(result.filePath), { recursive: true });
      await fs.promises.copyFile(targetPath, result.filePath);
      logHostFileAccess("host.download.response", { traceId, hostPath: maskHostPath(targetPath), savedPath: maskHostPath(result.filePath), size: stats.size });
      return { ok: true, path: targetPath, savedPath: result.filePath, fileName, size: stats.size };
    } catch (error) {
      logHostFileAccess("host.download.failed", { traceId, hostPath: maskHostPath(hostPath), errorCode: error?.code || "host_download_failed", error: error?.message || String(error) });
      return { ok: false, errorCode: error?.code || "host_download_failed", error: error?.message || String(error) };
    }
  });
}
