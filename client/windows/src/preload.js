/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("noobotDesktop", {
  onStartupStatus(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("noobot:startup-status", listener);
    return () => ipcRenderer.removeListener("noobot:startup-status", listener);
  },
  retryStartup() {
    return ipcRenderer.invoke("noobot:retry-startup");
  },
  getStartupStatuses() {
    return ipcRenderer.invoke("noobot:get-startup-statuses");
  },
});
