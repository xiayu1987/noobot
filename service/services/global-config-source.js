/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { readFile } from "node:fs/promises";

export function resolveServiceGlobalConfigPath({
  filePath = "",
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const explicitPath = String(filePath || "").trim();
  const envPath =
    String(env?.AGENT_GLOBAL_CONFIG_PATH || "").trim() ||
    String(env?.NOOBOT_GLOBAL_CONFIG_PATH || "").trim();
  const targetPath = explicitPath || envPath || "config/global.config.json";
  return path.resolve(cwd, targetPath);
}

export function createServiceGlobalConfigSource({
  filePath = "",
  cwd = process.cwd(),
  env = process.env,
  readFileFn = readFile,
} = {}) {
  const resolvedPath = resolveServiceGlobalConfigPath({ filePath, cwd, env });
  return {
    name: "service-file-source",
    async loadRawConfig() {
      return JSON.parse(await readFileFn(resolvedPath, "utf8"));
    },
    getResolvedPath() {
      return resolvedPath;
    },
  };
}
