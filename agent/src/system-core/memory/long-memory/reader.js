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
    relativePaths: ["memory/long-memory-model.md"],
  });
  return storage.fileExists(modelPath);
}

export async function readLongMemory(storage, basePath) {
  const longPath = storage.longPath(basePath);
  const text = String(await storage.readText(longPath, "") || "").trim();
  if (text) return text;
  const legacyJsonPath = longPath.replace(/\.md$/i, ".json");
  const longMem = await storage.readJson(legacyJsonPath, {});
  if (typeof longMem?.staticMemory === "string") return longMem.staticMemory;
  return String(longMem?.memory || "").trim();
}

function normalizeLongMemoryMetadata(raw = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const items = Array.isArray(source?.items) ? source.items : [];
  const map = new Map();
  for (const item of items) {
    const id = Number(item?.id);
    const key = String(item?.key || "").trim();
    const value = String(item?.value || "").trim();
    if (!Number.isFinite(id) || id <= 0 || !key || !value) continue;
    map.set(id, { id, key, value });
  }
  return [...map.values()].sort((a, b) => a.id - b.id);
}

export function renderLongMemoryMetadataItems(items = []) {
  return normalizeLongMemoryMetadata({ items })
    .map((item) => `M${item.id} key="${item.key}" value="${item.value}"`)
    .join("\n")
    .trim();
}

export async function readLongMemoryMetadata(storage, basePath) {
  const metadataPath = storage.longMemoryMetadataPath(basePath);
  const text = String(await storage.readText(metadataPath, "") || "").trim();
  if (text) return text;
  const legacyJsonPath = metadataPath.replace(/\.md$/i, ".json");
  const metadata = await storage.readJson(legacyJsonPath, {});
  return renderLongMemoryMetadataItems(metadata?.items);
}

export async function readLongMemoryModel(storage, basePath) {
  const modelPath = storage.longMemoryModelPath(basePath);
  const exists = await ensureLongMemoryModelJsonIfMissing(storage, basePath);
  if (exists) {
    const text = String(await storage.readText(modelPath, "") || "").trim();
    if (text) return text;
    const legacyJsonPath = modelPath.replace(/\.md$/i, ".json");
    const rawJson = await storage.readJson(legacyJsonPath, null);
    if (rawJson && typeof rawJson === "object") return JSON.stringify(rawJson, null, 2);
  }
  return "";
}
