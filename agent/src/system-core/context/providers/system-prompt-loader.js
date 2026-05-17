/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

let systemPromptCachePromise = null;

function resolveDefaultSystemPromptPath({
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const rawEnvPath = String(env?.AGENT_SYSTEM_PROMPT_PATH || "").trim();
  if (rawEnvPath) return path.resolve(cwd, rawEnvPath);
  return fileURLToPath(new URL("../../system-prompt/base.md", import.meta.url));
}

export async function loadSystemPrompt() {
  if (!systemPromptCachePromise) {
    const systemPromptPath = resolveDefaultSystemPromptPath();
    systemPromptCachePromise = readFile(systemPromptPath, "utf8")
      .catch((error) => {
        systemPromptCachePromise = null;
        throw error;
      });
  }
  return systemPromptCachePromise;
}
