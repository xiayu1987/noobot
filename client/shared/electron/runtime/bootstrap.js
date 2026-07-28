/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createDesktopBootstrap({
  createWindow,
  ensureServiceStarted,
  resolveNoobotUrl,
  getMainWindow,
  sendStatus,
  appendEarlyLog = () => {},
  appendDesktopLog = () => {},
  appendStartupLog = appendDesktopLog,
  healthUrl,
  defaultClientUrl,
} = {}) {
  let bootStarted = false;

  async function boot() {
    appendEarlyLog(`[main:boot] enter; bootStarted=${bootStarted}`);
    if (bootStarted) {
      appendEarlyLog("[main:boot] skipped; already started");
      return;
    }
    bootStarted = true;
    appendEarlyLog("[main:boot] before appendDesktopLog start");
    appendStartupLog("[main:boot] start");
    appendEarlyLog("[main:boot] before createWindow");
    createWindow();
    appendEarlyLog("[main:boot] after createWindow; before ensureServiceStarted");
    try {
      await ensureServiceStarted();
      appendEarlyLog("[main:boot] after ensureServiceStarted");
      const noobotUrl = await resolveNoobotUrl();
      sendStatus({ phase: "loading", message: `Loading ${noobotUrl}` });
      await getMainWindow()?.loadURL(noobotUrl);
    } catch (error) {
      sendStatus({
        phase: "error",
        message: error?.message || String(error),
        healthUrl,
        clientUrl: defaultClientUrl,
      });
    }
  }

  return {
    boot,
    hasBootStarted: () => bootStarted,
  };
}
