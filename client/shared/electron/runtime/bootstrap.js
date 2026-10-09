/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createDesktopBootstrap({
  createWindow,
  ensureServiceStarted,
  resolveNoobotUrl,
  loadNoobotUrl,
  isShowingStartupPage = () => false,
  sendStatus,
  appendEarlyLog = () => {},
  appendDesktopLog = () => {},
  appendStartupLog = appendDesktopLog,
  healthUrl,
  defaultClientUrl,
} = {}) {
  let bootStarted = false;

  async function showNoobot(prepare = async () => {}) {
    try {
      await prepare();
      const noobotUrl = await resolveNoobotUrl();
      sendStatus({ phase: "loading", message: `Loading ${noobotUrl}` });
      await loadNoobotUrl(noobotUrl);
    } catch (error) {
      sendStatus({
        phase: "error",
        retryable: true,
        message: error?.message || String(error),
        healthUrl,
        clientUrl: defaultClientUrl,
      });
    }
  }

  function openNoobot() {
    return showNoobot(ensureServiceStarted);
  }

  async function recoverNoobot() {
    if (!isShowingStartupPage()) return;
    await showNoobot();
  }

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
    await openNoobot();
    appendEarlyLog("[main:boot] after openNoobot");
  }

  return {
    boot,
    openNoobot,
    recoverNoobot,
    hasBootStarted: () => bootStarted,
  };
}
