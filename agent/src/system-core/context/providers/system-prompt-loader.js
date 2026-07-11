/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { normalizeLocale } from "noobot-i18n/shared";
import { filePath as path } from "../../utils/path-resolver.js";

const systemPromptCachePromises = new Map();

function resolveDefaultSystemPromptPath({
  cwd = process.cwd(),
  env = process.env,
  locale = "zh-CN",
} = {}) {
  const rawEnvPath = String(env?.AGENT_SYSTEM_PROMPT_PATH || "").trim();
  if (rawEnvPath) return path.resolve(cwd, rawEnvPath);
  const normalizedLocale = normalizeLocale(locale, "zh-CN");
  const fileName = normalizedLocale === "en-US" ? "base.en-US.md" : "base.zh-CN.md";
  return fileURLToPath(new URL(`../../system-prompt/${fileName}`, import.meta.url));
}

export async function loadSystemPrompt(options = {}) {
  const systemPromptPath = resolveDefaultSystemPromptPath(options);
  if (!systemPromptCachePromises.has(systemPromptPath)) {
    const systemPromptCachePromise = readFile(systemPromptPath, "utf8")
      .catch((error) => {
        systemPromptCachePromises.delete(systemPromptPath);
        throw error;
      });
    systemPromptCachePromises.set(systemPromptPath, systemPromptCachePromise);
  }
  return systemPromptCachePromises.get(systemPromptPath);
}
