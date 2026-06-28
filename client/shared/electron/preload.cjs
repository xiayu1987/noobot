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
  saveConfigParams(values) {
    return ipcRenderer.invoke("noobot:save-config-params", values);
  },
  skipConfigParams() {
    return ipcRenderer.invoke("noobot:skip-config-params");
  },
  saveSuperAdmin(values) {
    return ipcRenderer.invoke("noobot:save-super-admin", values);
  },
  saveDownload({ fileName, bytes } = {}) {
    return ipcRenderer.invoke("noobot:save-download", { fileName, bytes });
  },
  readHostFile({ path, traceId } = {}) {
    return ipcRenderer.invoke("noobot:read-host-file", { path, traceId });
  },
  downloadHostFile({ path, traceId } = {}) {
    return ipcRenderer.invoke("noobot:download-host-file", { path, traceId });
  },
  logFileAccess(payload = {}) {
    return ipcRenderer.invoke("noobot:file-access-log", payload);
  },
});
