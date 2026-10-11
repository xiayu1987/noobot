/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";

function requireConfiguredPath(value, key) {
  const configured = String(value || "").trim();
  if (!configured) throw new TypeError(`global config ${key} is required`);
  return configured;
}

export function createWorkspacePathService({
  getGlobalConfig,
  getGlobalConfigRaw,
  getProcessCwd = () => process.cwd(),
} = {}) {
  function workspaceRootPath() {
    return path.resolve(
      getProcessCwd(),
      requireConfiguredPath(getGlobalConfig()?.workspaceRoot, "workspace_root"),
    );
  }

  function templateRootPath() {
    return path.resolve(
      getProcessCwd(),
      requireConfiguredPath(getGlobalConfigRaw()?.workspaceTemplatePath, "workspace_template_path"),
    );
  }

  return {
    workspaceRootPath,
    templateRootPath,
  };
}
