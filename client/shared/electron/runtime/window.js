/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { clientFilePath as path } from "../../path-resolver.js";
import { installDesktopNavigation } from "./navigation.js";

const require = createRequire(import.meta.url);
const ERR_ABORTED = -3;

export function createDesktopWindowManager({
  app,
  dirname,
  agentProxyOrigin,
  defaultClientUrl,
  electron = require("electron"),
  platform = process.platform,
  appendEarlyLog = () => {},
  appendDesktopLog = () => {},
  sendStatus = () => {},
} = {}) {
  const { BrowserWindow, Menu, shell, Tray } = electron;
  let mainWindow = null;
  let tray = null;
  let isQuitting = false;
  let startupUrl = "";
  let startupFile = "";
  let showingStartupPage = false;
  let noobotUrl = "";

  function getTrayIconPath() {
    if (process.env.NOOBOT_DESKTOP_TRAY_ICON) return process.env.NOOBOT_DESKTOP_TRAY_ICON;
    if (platform === "darwin") {
      return path.join(process.env.NOOBOT_DESKTOP_PROJECT_DIR, "assets", "noobot.icns");
    }
    return process.env.NOOBOT_DESKTOP_WINDOW_ICON;
  }

  function showMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  function quitFromTray() {
    isQuitting = true;
    app.quit();
  }

  function createTray() {
    if (tray) return tray;
    tray = new Tray(getTrayIconPath());
    tray.setToolTip("Noobot");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "显示 Noobot", click: showMainWindow },
        { type: "separator" },
        { label: "退出 Noobot", click: quitFromTray },
      ]),
    );
    tray.on("click", showMainWindow);
    return tray;
  }

  function reloadWebContents(webContents = mainWindow?.webContents) {
    if (!webContents || webContents.isDestroyed())
      return { ok: false, error: "webContents unavailable" };
    webContents.reload();
    return { ok: true };
  }

  async function loadNoobotUrl(url) {
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error("Noobot window unavailable");
    noobotUrl = new URL(url).href;
    showingStartupPage = false;
    await mainWindow.loadURL(noobotUrl);
  }

  function loadStartupPage() {
    showingStartupPage = true;
    return mainWindow.loadFile(startupFile);
  }

  function createContextMenuTemplate(params = {}, webContents = mainWindow?.webContents) {
    const template = [];
    if (params.isEditable) {
      template.push(
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
      );
    } else if (params.selectionText) {
      template.push({ role: "copy" }, { type: "separator" });
    }
    template.push(
      {
        label: platform === "darwin" ? "Return to Noobot" : "返回 Noobot",
        enabled: Boolean(noobotUrl),
        click: () =>
          loadNoobotUrl(noobotUrl).catch((error) =>
            appendDesktopLog(`[main:navigation] return to Noobot failed: ${error.message}`),
          ),
      },
      {
        label: platform === "darwin" ? "Reload" : "重新加载",
        accelerator: "CmdOrCtrl+R",
        click: () => reloadWebContents(webContents),
      },
    );
    return template;
  }

  function createWindow() {
    appendEarlyLog("[main:create-window] enter");
    appendDesktopLog("[main:create-window] creating startup window");
    Menu.setApplicationMenu(
      platform === "darwin"
        ? Menu.buildFromTemplate([
            { role: "appMenu" },
            { role: "editMenu" },
            { role: "windowMenu" },
          ])
        : null,
    );
    appendEarlyLog("[main:create-window] before BrowserWindow");
    const windowIconPath =
      process.env.NOOBOT_DESKTOP_WINDOW_ICON ||
      path.join(dirname, "..", "..", "windows", "assets", "noobot.ico");
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
    createTray();

    mainWindow.on("close", (event) => {
      if (isQuitting) return;
      event.preventDefault();
      mainWindow?.hide();
      appendDesktopLog("[main:window] close intercepted; window hidden");
    });

    mainWindow.once("ready-to-show", () => {
      appendDesktopLog("[main:window] ready-to-show");
      mainWindow?.show();
    });
    mainWindow.webContents.once("did-finish-load", () =>
      appendDesktopLog(`[main:window] did-finish-load ${mainWindow?.webContents.getURL() || ""}`),
    );
    mainWindow.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      appendDesktopLog(
        `[main:window] did-fail-load code=${code} description=${description} url=${url}`,
      );
      handleMainFrameLoadFailure({ code, description, url, isMainFrame });
    });
    mainWindow.webContents.on("preload-error", (_event, preloadPath, error) =>
      appendDesktopLog(
        `[main:window] preload-error path=${preloadPath} error=${error?.stack || error?.message || String(error)}`,
      ),
    );
    mainWindow.webContents.on("render-process-gone", (_event, details) =>
      appendDesktopLog(
        `[main:window] render-process-gone reason=${details.reason} exitCode=${details.exitCode}`,
      ),
    );
    installDesktopNavigation({
      webContents: mainWindow.webContents,
      getDocumentUrl: () => noobotUrl || startupUrl,
      openExternal: (url) => shell.openExternal(url),
      appendDesktopLog,
    });
    mainWindow.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || input.alt || input.shift) return;
      const primaryModifier =
        platform === "darwin" ? input.meta && !input.control : input.control && !input.meta;
      const refresh =
        (primaryModifier && input.key.toLowerCase() === "r") ||
        (input.key === "F5" && !input.control && !input.meta);
      if (!refresh) return;
      event.preventDefault();
      reloadWebContents();
    });
    mainWindow.webContents.on("context-menu", (_event, params) => {
      if (platform !== "win32" && platform !== "darwin") return;
      Menu.buildFromTemplate(createContextMenuTemplate(params, mainWindow?.webContents)).popup({
        window: mainWindow,
      });
    });
    const builtStartupFile = path.join(dirname, "startup", "index.html");
    startupFile = fs.existsSync(builtStartupFile)
      ? builtStartupFile
      : path.join(dirname, "startup.html");
    startupUrl = pathToFileURL(startupFile).href;
    appendDesktopLog(`[main:create-window] loading ${startupFile}`);
    appendEarlyLog(`[main:create-window] before loadFile ${startupFile}`);
    loadStartupPage().catch((error) =>
      appendDesktopLog(
        `[main:create-window] loadFile failed: ${error?.stack || error?.message || String(error)}`,
      ),
    );
    appendEarlyLog("[main:create-window] after loadFile call");
    return mainWindow;
  }

  function handleMainFrameLoadFailure({ code, description, url, isMainFrame }) {
    if (!isMainFrame || code === ERR_ABORTED) return;
    if (!noobotUrl || !mainWindow || mainWindow.isDestroyed()) return;
    let failedUrl;
    try {
      failedUrl = new URL(url);
    } catch {
      return;
    }
    if (failedUrl.origin !== new URL(noobotUrl).origin) return;
    noobotUrl = failedUrl.href;
    appendDesktopLog(`[main:window] main frame load failed; showing startup page (${noobotUrl})`);
    loadStartupPage()
      .then(() =>
        sendStatus({
          phase: "error",
          retryable: true,
          message: `Failed to load Noobot (${code} ${description}). The backend may have stopped; retry to restart it.`,
        }),
      )
      .catch((error) =>
        appendDesktopLog(`[main:window] startup fallback failed: ${error?.message || error}`),
      );
  }

  async function resolveNoobotUrl() {
    if (noobotUrl) return noobotUrl;
    if (app.isPackaged) {
      const packagedFrontendIndex = path.join(process.resourcesPath, "frontend", "index.html");
      if (fs.existsSync(packagedFrontendIndex)) return agentProxyOrigin;
      appendDesktopLog(`[main:frontend] packaged frontend not found: ${packagedFrontendIndex}`);
    }

    return defaultClientUrl;
  }

  return {
    createWindow,
    createTray,
    allowQuit: () => {
      isQuitting = true;
    },
    showMainWindow,
    resolveNoobotUrl,
    loadNoobotUrl,
    isShowingStartupPage: () => showingStartupPage,
    reloadWebContents,
    getMainWindow: () => mainWindow,
  };
}
