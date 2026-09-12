/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export async function readLongMemory(storage, basePath) {
  const longPath = storage.longPath(basePath);
  return String((await storage.readText(longPath, "")) || "").trim();
}

export async function readLongMemoryMetadata(storage, basePath) {
  const metadataPath = storage.longMemoryMetadataPath(basePath);
  return String((await storage.readText(metadataPath, "")) || "").trim();
}

export async function readLongMemoryModel(storage, basePath) {
  const modelPath = storage.longMemoryModelPath(basePath);
  return String((await storage.readText(modelPath, "")) || "").trim();
}
