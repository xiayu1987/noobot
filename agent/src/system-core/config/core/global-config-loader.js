/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import { normalizeKnownConfigKeys } from "./key-normalizer.js";

function resolveDefaultGlobalConfigPath({
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const rawEnvPath =
    String(env?.AGENT_GLOBAL_CONFIG_PATH || "").trim() ||
    String(env?.NOOBOT_GLOBAL_CONFIG_PATH || "").trim();
  if (rawEnvPath) return path.resolve(cwd, rawEnvPath);
  return path.resolve(cwd, "config/global.config.json");
}

export async function loadGlobalConfig(filePath = "", options = {}) {
  const targetPath = String(filePath || "").trim() || resolveDefaultGlobalConfigPath(options);
  return normalizeKnownConfigKeys(JSON.parse(await readFile(targetPath, "utf8")));
}
