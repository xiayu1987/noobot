/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isBlankLongMemoryContent } from "../utils/format.js";

export async function updateLongMemory(storage, basePath, content) {
  if (isBlankLongMemoryContent(content)) return false;
  const longPath = storage.longPath(basePath);
  const longMem = await storage.readJson(longPath, {});
  longMem.memory = content;
  longMem.staticMemory = content;
  longMem.updatedAt = new Date().toISOString();
  await storage.writeJson(longPath, longMem);
  return true;
}

