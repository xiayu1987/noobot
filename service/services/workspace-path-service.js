/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import {
  WORKSPACE_ROOT_ENV,
  requireWorkspaceRootEnv,
  resolveWorkspaceRootPath,
} from "@noobot/runtime-topology-protocol/workspace-root";

function requireConfiguredPath(value, key) {
  const configured = String(value || "").trim();
  if (!configured) throw new TypeError(`global config ${key} is required`);
  return configured;
}

export function createWorkspacePathService({ serviceDir, getGlobalConfigRaw } = {}) {
  if (!serviceDir || !path.isAbsolute(serviceDir)) {
    throw new TypeError("createWorkspacePathService requires an absolute serviceDir");
  }

  function workspaceRootPath() {
    return resolveWorkspaceRootPath({
      configuredRoot: getGlobalConfigRaw()?.workspaceRoot,
      serviceDir,
    });
  }

  function templateRootPath() {
    return path.resolve(
      serviceDir,
      requireConfiguredPath(getGlobalConfigRaw()?.workspaceTemplatePath, "workspace_template_path"),
    );
  }

  function assertWorkspaceRootMatchesEnv(env = process.env) {
    const configured = workspaceRootPath();
    const injected = requireWorkspaceRootEnv(env);
    if (path.resolve(injected) !== configured) {
      throw new Error(
        `${WORKSPACE_ROOT_ENV} (${injected}) does not match global config workspace_root (${configured})`,
      );
    }
    return configured;
  }

  return {
    workspaceRootPath,
    templateRootPath,
    assertWorkspaceRootMatchesEnv,
  };
}
