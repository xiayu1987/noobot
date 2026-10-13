/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import { resolveGlobalConfigPath } from "@noobot/runtime-topology-protocol/workspace-root";

export function resolveServiceGlobalConfigPath({
  filePath = "",
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  return resolveGlobalConfigPath({ serviceDir: cwd, filePath, env });
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
