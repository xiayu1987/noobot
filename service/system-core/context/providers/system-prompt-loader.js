/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";

let systemPromptCachePromise = null;

export async function loadSystemPrompt() {
  if (!systemPromptCachePromise) {
    systemPromptCachePromise = readFile("./system-core/system-prompt/base.md", "utf8")
      .catch((error) => {
        systemPromptCachePromise = null;
        throw error;
      });
  }
  return systemPromptCachePromise;
}
