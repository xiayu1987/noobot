/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BrowserWindow, shell } from "electron";
import fs from "node:fs";
import path from "node:path";

export function createDesktopWindowManager({
  app,
  dirname,
  agentProxyOrigin,
  defaultClientUrl,
  appendEarlyLog = () => {},
  appendDesktopLog = () => {},
} = {}) {
  let mainWindow = null;

  function createWindow() {
    appendEarlyLog("[main:create-window] enter");
    appendDesktopLog("[main:create-window] creating startup window");
    appendEarlyLog("[main:create-window] before BrowserWindow");
    const windowIconPath = process.env.NOOBOT_DESKTOP_WINDOW_ICON || path.join(dirname, "..", "..", "windows", "assets", "noobot.ico");
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 960,
      minHeight: 640,
      show: false,
      title: "Noobot",
      icon: windowIconPath,
      webPreferences: {
        preload: path.join(dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    appendEarlyLog("[main:create-window] after BrowserWindow");

    mainWindow.once("ready-to-show", () => {
      appendDesktopLog("[main:window] ready-to-show");
      mainWindow?.show();
    });
    mainWindow.webContents.once("did-finish-load", () => appendDesktopLog(`[main:window] did-finish-load ${mainWindow?.webContents.getURL() || ""}`));
    mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => appendDesktopLog(`[main:window] did-fail-load code=${code} description=${description} url=${url}`));
    mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => appendDesktopLog(`[main:window] preload-error path=${preloadPath} error=${error?.stack || error?.message || String(error)}`));
    mainWindow.webContents.on("render-process-gone", (_event, details) => appendDesktopLog(`[main:window] render-process-gone reason=${details.reason} exitCode=${details.exitCode}`));
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: "deny" };
    });
    const builtStartupFile = path.join(dirname, "startup", "index.html");
    const startupFile = fs.existsSync(builtStartupFile) ? builtStartupFile : path.join(dirname, "startup.html");
    appendDesktopLog(`[main:create-window] loading ${startupFile}`);
    appendEarlyLog(`[main:create-window] before loadFile ${startupFile}`);
    mainWindow.loadFile(startupFile).catch((error) => appendDesktopLog(`[main:create-window] loadFile failed: ${error?.stack || error?.message || String(error)}`));
    appendEarlyLog("[main:create-window] after loadFile call");
    return mainWindow;
  }

  async function resolveNoobotUrl() {
    if (app.isPackaged) {
      const packagedFrontendIndex = path.join(process.resourcesPath, "frontend", "index.html");
      if (fs.existsSync(packagedFrontendIndex)) return agentProxyOrigin;
      appendDesktopLog(`[main:frontend] packaged frontend not found: ${packagedFrontendIndex}`);
    }

    // Development keeps loading the Vite dev server so frontend hot reload remains usable.
    return defaultClientUrl;
  }

  return {
    createWindow,
    resolveNoobotUrl,
    getMainWindow: () => mainWindow,
  };
}
