/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs";
import path from "node:path";
import { text } from "@noobot/shared/value";

export const WORKSPACE_ROOT_ENV = "NOOBOT_WORKSPACE_ROOT";
export const GLOBAL_CONFIG_PATH_ENV = "NOOBOT_GLOBAL_CONFIG_PATH";
export const DEFAULT_GLOBAL_CONFIG_RELATIVE_PATH = "config/global.config.json";

export function resolveGlobalConfigPath({ serviceDir, filePath = "", env = process.env } = {}) {
  if (!serviceDir || !path.isAbsolute(serviceDir)) {
    throw new TypeError("resolveGlobalConfigPath requires an absolute serviceDir");
  }
  const explicitPath = text(filePath);
  const envPath = text(env?.[GLOBAL_CONFIG_PATH_ENV]);
  return path.resolve(serviceDir, explicitPath || envPath || DEFAULT_GLOBAL_CONFIG_RELATIVE_PATH);
}

export function resolveWorkspaceRootPath({ configuredRoot, serviceDir } = {}) {
  if (!serviceDir || !path.isAbsolute(serviceDir)) {
    throw new TypeError("resolveWorkspaceRootPath requires an absolute serviceDir");
  }
  const configured = typeof configuredRoot === "string" ? configuredRoot.trim() : "";
  if (!configured) throw new TypeError("global config workspace_root is required");
  return path.resolve(serviceDir, configured);
}

export function resolveConfiguredWorkspaceRoot({ globalConfigPath, serviceDir } = {}) {
  if (!globalConfigPath || !path.isAbsolute(globalConfigPath)) {
    throw new TypeError("resolveConfiguredWorkspaceRoot requires an absolute globalConfigPath");
  }
  const config = JSON.parse(fs.readFileSync(globalConfigPath, "utf8"));
  return resolveWorkspaceRootPath({ configuredRoot: config?.workspace_root, serviceDir });
}

export function requireWorkspaceRootEnv(env = process.env) {
  const value = String(env?.[WORKSPACE_ROOT_ENV] ?? "").trim();
  if (!value) throw new Error(`${WORKSPACE_ROOT_ENV} is required`);
  if (!path.isAbsolute(value)) throw new Error(`${WORKSPACE_ROOT_ENV} must be an absolute path`);
  return value;
}
