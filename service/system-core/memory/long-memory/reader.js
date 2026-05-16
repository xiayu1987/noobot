/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export async function readLongMemory(storage, basePath) {
  const longMem = await storage.readJson(storage.longPath(basePath), {});
  if (typeof longMem?.staticMemory === "string") return longMem.staticMemory;
  return longMem.memory ?? "";
}

export async function readLongMemoryModel(storage, basePath) {
  const modelPath = storage.longMemoryModelPath(basePath);
  const exists = await storage.fileExists(modelPath);
  if (!exists) return "";
  return String(await storage.readText(modelPath, "") || "").trim();
}

