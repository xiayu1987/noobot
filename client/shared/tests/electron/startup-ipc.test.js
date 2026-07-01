/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { registerStartupIpcHandlers } from "../../electron/startup-ipc.js";

function createIpcMainMock() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  };
}

test("save super admin refreshes desktop config before writing user template config", async () => {
  const ipcMain = createIpcMainMock();
  const calls = [];
  const userDataPath = path.join("C:", "Users", "Noobot", "AppData", "Roaming", "Noobot");
  const staleState = {
    globalConfigPath: path.join(userDataPath, "config", "stale-global.config.json"),
    workspaceRootPath: path.join(userDataPath, "stale-workspace"),
    workspaceTemplatePath: path.join(userDataPath, "stale-user-template", "default-user"),
    templateConfigPath: path.join(userDataPath, "stale-user-template", "default-user", "config.json"),
    superAdmin: { missing: true },
    missingParams: [],
  };
  const refreshedState = {
    globalConfigPath: path.join(userDataPath, "config", "global.config.json"),
    workspaceRootPath: path.join(userDataPath, "workspace"),
    workspaceTemplatePath: path.join(userDataPath, "user-template", "default-user"),
    templateConfigPath: path.join(userDataPath, "user-template", "default-user", "config.json"),
    superAdmin: { missing: false, userId: "owner", connectCode: "secret" },
    missingParams: [],
  };
  let desktopConfigState = staleState;

  registerStartupIpcHandlers({
    app: {
      isPackaged: true,
      getPath: (name) => {
        assert.equal(name, "userData");
        return userDataPath;
      },
    },
    ipcMain,
    getDesktopConfigState: () => desktopConfigState,
    setDesktopConfigState: (state) => {
      calls.push(["setDesktopConfigState", state.templateConfigPath]);
      desktopConfigState = state;
    },
    ensureDesktopGlobalConfig: ({ isPackaged, userDataPath: requestedUserDataPath }) => {
      calls.push(["ensureDesktopGlobalConfig", { isPackaged, userDataPath: requestedUserDataPath }]);
      return refreshedState;
    },
    saveSuperAdminConfig: ({ globalConfigPath, userConfigPath, userId, connectCode }) => {
      calls.push(["saveSuperAdminConfig", { globalConfigPath, userConfigPath, userId, connectCode }]);
    },
    ensureSelectedDependencies: async () => {
      calls.push(["ensureSelectedDependencies"]);
      return [];
    },
  });

  const result = await ipcMain.handlers.get("noobot:save-super-admin")(null, {
    userId: "owner",
    connectCode: "secret",
    language: "en-US",
    model: "openai",
  });

  assert.deepEqual(result, { ok: true, dependencies: [] });
  assert.equal(calls[0][0], "ensureDesktopGlobalConfig");
  assert.equal(calls[1][0], "setDesktopConfigState");
  assert.deepEqual(calls[2], [
    "saveSuperAdminConfig",
    {
      globalConfigPath: refreshedState.globalConfigPath,
      userConfigPath: refreshedState.templateConfigPath,
      userId: "owner",
      connectCode: "secret",
    },
  ]);
  assert.notEqual(calls[2][1].userConfigPath, staleState.templateConfigPath);
});
