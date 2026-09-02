/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { AnimationAssetSchema } from "./animation-protocol.js";
import { migrateLegacyAssetDescriptor } from "./asset-metadata-migration.js";

export async function readCharacterAssetCatalog(basePath) {
  const workspacePath = String(basePath || "").trim();
  if (!workspacePath) throw new Error("character asset workspace path is required");
  const catalogPath = path.resolve(workspacePath, "runtime/plugin-assets/character/catalog.json");
  let catalog;
  try {
    catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new TypeError("character asset catalog must be an object");
  }
  return Object.entries(catalog).map(([assetId, value]) => {
    const asset = AnimationAssetSchema.parse(migrateLegacyAssetDescriptor(value) || value);
    if (asset.assetId !== assetId) {
      throw new TypeError("character asset catalog identity mismatch");
    }
    return asset;
  });
}

export async function readSelectedCharacterAssets(config = {}) {
  const selectedIds = new Set(
    Array.isArray(config.selectedCharacterAssetIds)
      ? config.selectedCharacterAssetIds.map((item) => String(item || "").trim())
      : [],
  );
  if (!selectedIds.size) return [];
  return (await readCharacterAssetCatalog(config.basePath)).filter((asset) =>
    selectedIds.has(asset.assetId),
  );
}
