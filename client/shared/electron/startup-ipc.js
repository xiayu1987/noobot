/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ipcMain } from "electron";

export function createStartupConfigRequesters({ sendStatus = () => {}, setPendingConfigResolve = () => {}, setPendingSuperAdminResolve = () => {} } = {}) {
  function requestSuperAdminConfig(superAdmin) {
    sendStatus({
      phase: "super-admin-required",
      message: "Please set the super admin username and connect code before starting Noobot.",
      superAdmin,
    });
    return new Promise((resolve) => {
      setPendingSuperAdminResolve(resolve);
    });
  }

  function requestMissingConfigParams(missingParams) {
    sendStatus({ phase: "config-optional", message: "Optional configuration variables can be filled now or skipped.", params: missingParams });
    return new Promise((resolve) => {
      setPendingConfigResolve(resolve);
    });
  }

  return { requestSuperAdminConfig, requestMissingConfigParams };
}

export function registerStartupIpcHandlers({
  app,
  getStartupStatuses = () => [],
  getDesktopConfigState = () => null,
  setDesktopConfigState = () => {},
  getPendingConfigResolve = () => null,
  setPendingConfigResolve = () => {},
  getPendingSuperAdminResolve = () => null,
  setPendingSuperAdminResolve = () => {},
  ensureDesktopGlobalConfig,
  saveConfigParamValues,
  saveSuperAdminConfig,
  ensureSelectedDependencies,
  ensureServiceStarted,
  resolveNoobotUrl,
  getMainWindow = () => null,
  sendStatus = () => {},
} = {}) {
  ipcMain.handle("noobot:retry-startup", async () => {
    await ensureServiceStarted();
    const noobotUrl = await resolveNoobotUrl();
    await getMainWindow()?.loadURL(noobotUrl);
  });

  ipcMain.handle("noobot:get-startup-statuses", () => getStartupStatuses());

  ipcMain.handle("noobot:save-config-params", (_event, values) => {
    const state = getDesktopConfigState() || ensureDesktopGlobalConfig({ isPackaged: app.isPackaged, userDataPath: app.getPath("userData") });
    saveConfigParamValues({ workspaceRootPath: state.workspaceRootPath, values });
    setDesktopConfigState(ensureDesktopGlobalConfig({ isPackaged: app.isPackaged, userDataPath: app.getPath("userData") }));
    const pendingConfigResolve = getPendingConfigResolve();
    if (pendingConfigResolve) {
      setPendingConfigResolve(null);
      pendingConfigResolve();
    }
    return { ok: true };
  });

  ipcMain.handle("noobot:skip-config-params", () => {
    const pendingConfigResolve = getPendingConfigResolve();
    if (pendingConfigResolve) {
      setPendingConfigResolve(null);
      pendingConfigResolve();
    }
    return { ok: true };
  });

  ipcMain.handle("noobot:save-super-admin", async (_event, values = {}) => {
    const state = getDesktopConfigState() || ensureDesktopGlobalConfig({ isPackaged: app.isPackaged, userDataPath: app.getPath("userData") });
    saveSuperAdminConfig({ globalConfigPath: state.globalConfigPath, userConfigPath: state.templateConfigPath, userId: values.userId, connectCode: values.connectCode, language: values.language, model: values.model });
    const dependencyResults = await ensureSelectedDependencies(values.dependencies || {});
    const nextState = ensureDesktopGlobalConfig({ isPackaged: app.isPackaged, userDataPath: app.getPath("userData") });
    setDesktopConfigState(nextState);
    if (nextState.superAdmin?.missing) {
      sendStatus({ phase: "super-admin-required", message: "Please complete super admin setup.", superAdmin: nextState.superAdmin });
      return { ok: false, superAdmin: nextState.superAdmin };
    }
    const pendingSuperAdminResolve = getPendingSuperAdminResolve();
    if (pendingSuperAdminResolve) {
      setPendingSuperAdminResolve(null);
      pendingSuperAdminResolve();
    }
    return { ok: true, dependencies: dependencyResults };
  });
}
