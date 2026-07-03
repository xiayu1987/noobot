/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createRequire } from "node:module";
import { maskDependencyProxyUrl, validateDependencyProxy } from "./dependency-proxy.js";

const require = createRequire(import.meta.url);

function getDefaultIpcMain() {
  return require("electron").ipcMain;
}

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
  ipcMain = getDefaultIpcMain(),
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
  reloadWebContents = () => ({ ok: false, error: "reload unavailable" }),
  resolveNoobotUrl,
  getMainWindow = () => null,
  sendStatus = () => {},
  runProcess,
} = {}) {
  function refreshDesktopConfigState() {
    const state = ensureDesktopGlobalConfig({ isPackaged: app.isPackaged, userDataPath: app.getPath("userData") });
    setDesktopConfigState(state);
    return state;
  }

  ipcMain.handle("noobot:retry-startup", async () => {
    await ensureServiceStarted();
    const noobotUrl = await resolveNoobotUrl();
    await getMainWindow()?.loadURL(noobotUrl);
  });

  ipcMain.handle("noobot:get-startup-statuses", () => getStartupStatuses());

  ipcMain.handle("noobot:reload", () => reloadWebContents());

  ipcMain.handle("noobot:save-config-params", (_event, values) => {
    const state = refreshDesktopConfigState();
    saveConfigParamValues({ workspaceRootPath: state.workspaceRootPath, values });
    refreshDesktopConfigState();
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
    const state = refreshDesktopConfigState();
    const proxyUrl = String(values.dependencyProxyUrl || "").trim();
    if (proxyUrl) {
      sendStatus({ phase: "dependency", message: `Checking dependency download proxy ${maskDependencyProxyUrl(proxyUrl)}...` });
      const proxyValidation = await validateDependencyProxy({ proxyUrl, runProcess });
      if (!proxyValidation.ok) {
        const superAdmin = { ...state.superAdmin, language: values.language, model: values.model, userId: values.userId, connectCode: values.connectCode, dependencyProxyUrl: proxyUrl };
        sendStatus({ phase: "super-admin-required", message: `Dependency download proxy is not reachable: ${proxyValidation.error || "validation failed"}`, superAdmin });
        return { ok: false, error: `Dependency download proxy is not reachable: ${proxyValidation.error || "validation failed"}`, superAdmin };
      }
      sendStatus({ phase: "dependency", message: `Dependency download proxy is available: ${proxyValidation.maskedProxyUrl}` });
    }
    saveSuperAdminConfig({ globalConfigPath: state.globalConfigPath, userConfigPath: state.templateConfigPath, userId: values.userId, connectCode: values.connectCode, language: values.language, model: values.model, dependencyProxyUrl: proxyUrl });
    refreshDesktopConfigState();
    sendStatus({ phase: "dependency", message: proxyUrl ? `Dependency downloads will use proxy ${maskDependencyProxyUrl(proxyUrl)}.` : "Dependency downloads will not use a proxy." });
    const dependencyResults = await ensureSelectedDependencies(values.dependencies || {});
    const nextState = refreshDesktopConfigState();
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
