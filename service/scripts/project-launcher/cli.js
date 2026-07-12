/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import process from "node:process";
import { resolveServiceGlobalConfigPath } from "../../services/global-config-source.js";
import {
  DEFAULT_TEMPLATE_PATH,
  DEFAULT_WORKSPACE_ROOT,
  MODEL_FORMAT_VALUES,
} from "./constants.js";
import { firstNonEmptyString } from "./utils.js";

export function parseCliOptions(argv = []) {
  const items = Array.isArray(argv) ? argv : [];
  const options = {
    nonInteractive: items.includes("--non-interactive"),
    lang: "",
    globalConfigPath: "",
  };

  for (let index = 0; index < items.length; index += 1) {
    const item = String(items[index] || "").trim();
    if (item.startsWith("--lang=")) {
      options.lang = item.slice("--lang=".length).trim();
      continue;
    }
    if (item === "--lang") {
      options.lang = String(items[index + 1] || "").trim();
      index += 1;
    }
    if (item.startsWith("--global-config-path=")) {
      options.globalConfigPath = item.slice("--global-config-path=".length).trim();
      continue;
    }
    if (item === "--global-config-path") {
      options.globalConfigPath = String(items[index + 1] || "").trim();
      index += 1;
    }
  }

  return options;
}

export function resolveConfiguredWorkspaceRoot(config = {}) {
  return firstNonEmptyString(config?.workspace_root, config?.workspaceRoot, DEFAULT_WORKSPACE_ROOT);
}

export function resolveConfiguredWorkspaceTemplatePath(config = {}) {
  return firstNonEmptyString(
    config?.workspace_template_path,
    config?.workspaceTemplatePath,
    DEFAULT_TEMPLATE_PATH,
  );
}

export function resolveConfiguredSuperAdminUserId(config = {}) {
  return firstNonEmptyString(config?.super_admin?.user_id, config?.superAdmin?.userId);
}

export function resolveLauncherGlobalConfigPath({ serviceRoot, cliOptions = {}, env = process.env } = {}) {
  return resolveServiceGlobalConfigPath({
    filePath: cliOptions?.globalConfigPath || "",
    cwd: serviceRoot,
    env,
  });
}

export function normalizeModelFormat(input = "") {
  const format = String(input || "").trim().toLowerCase();
  if (!format) return "";
  return MODEL_FORMAT_VALUES.has(format) ? format : "";
}
