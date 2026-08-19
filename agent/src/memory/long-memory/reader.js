/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export async function readLongMemory(storage, basePath) {
  const longPath = storage.longPath(basePath);
  return String((await storage.readText(longPath, "")) || "").trim();
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
  return String((await storage.readText(metadataPath, "")) || "").trim();
}

export async function readLongMemoryModel(storage, basePath) {
  const modelPath = storage.longMemoryModelPath(basePath);
  return String((await storage.readText(modelPath, "")) || "").trim();
}
