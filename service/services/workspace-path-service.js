/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";

export function createWorkspacePathService({
  getGlobalConfig,
  getGlobalConfigRaw,
  getProcessCwd = () => process.cwd(),
} = {}) {
  function workspaceRootPath() {
    const globalConfig = typeof getGlobalConfig === "function" ? getGlobalConfig() : {};
    return path.resolve(
      getProcessCwd(),
      String(globalConfig?.workspaceRoot || "../workspaces"),
    );
  }

  function templateRootPath() {
    const globalConfigRaw =
      typeof getGlobalConfigRaw === "function" ? getGlobalConfigRaw() : {};
    return path.resolve(
      getProcessCwd(),
      String(globalConfigRaw?.workspaceTemplatePath || "../user-template/default-user"),
    );
  }

  return {
    workspaceRootPath,
    templateRootPath,
  };
}
