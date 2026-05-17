/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import path from "node:path";
import { ensureUserWorkspaceMissingFilesFromTemplate } from "../../init/index.js";

function resolveUserIdFromBasePath(storage, basePath = "") {
  const workspaceRoot = path.resolve(String(storage?.globalConfig?.workspaceRoot || "").trim());
  const normalizedBasePath = path.resolve(String(basePath || "").trim());
  if (!workspaceRoot || !normalizedBasePath) return "";
  const relative = path.relative(workspaceRoot, normalizedBasePath);
  if (!relative || relative.startsWith("..")) return "";
  const userId = String(relative || "").split(path.sep)[0] || "";
  return String(userId || "").trim();
}

async function ensureLongMemoryModelJsonIfMissing(storage, basePath = "") {
  const modelPath = storage.longMemoryModelPath(basePath);
  if (await storage.fileExists(modelPath)) return true;
  const workspaceRoot = String(storage?.globalConfig?.workspaceRoot || "").trim();
  const workspaceTemplatePath = String(
    storage?.globalConfig?.workspaceTemplatePath || "",
  ).trim();
  const userId = resolveUserIdFromBasePath(storage, basePath);
  if (!workspaceRoot || !workspaceTemplatePath || !userId) return false;
  await ensureUserWorkspaceMissingFilesFromTemplate({
    workspaceRoot,
    workspaceTemplatePath,
    userId,
    relativePaths: ["memory/long-memory-model.json"],
  });
  return storage.fileExists(modelPath);
}

export async function readLongMemory(storage, basePath) {
  const longMem = await storage.readJson(storage.longPath(basePath), {});
  if (typeof longMem?.staticMemory === "string") return longMem.staticMemory;
  return longMem.memory ?? "";
}

export async function readLongMemoryModel(storage, basePath) {
  const modelPath = storage.longMemoryModelPath(basePath);
  const exists = await ensureLongMemoryModelJsonIfMissing(storage, basePath);
  if (exists) {
    const rawJson = await storage.readJson(modelPath, null);
    if (rawJson && typeof rawJson === "object") {
      return JSON.stringify(rawJson, null, 2);
    }
    return String(await storage.readText(modelPath, "") || "").trim();
  }
  return "";
}
