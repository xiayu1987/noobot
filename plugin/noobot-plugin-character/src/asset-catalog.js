/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import path from "node:path";
import { resolvePluginAssetsRelativePath } from "@noobot/workspace-protocol";
import { CHARACTER_PLUGIN_ID } from "./contract.js";
import { AnimationAssetSchema } from "./animation-protocol.js";
import { migrateLegacyAssetDescriptor } from "./asset-metadata-migration.js";
import { text, isPlainObject } from "@noobot/shared/value";

async function readCharacterAssetCatalog(basePath) {
  const workspacePath = text(basePath);
  if (!workspacePath) throw new Error("character asset workspace path is required");
  const catalogPath = path.resolve(
    workspacePath,
    resolvePluginAssetsRelativePath(CHARACTER_PLUGIN_ID, "catalog.json"),
  );
  let catalog;
  try {
    catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  if (!isPlainObject(catalog)) {
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
      ? config.selectedCharacterAssetIds.map((item) => text(item))
      : [],
  );
  if (!selectedIds.size) return [];
  return (await readCharacterAssetCatalog(config.basePath)).filter((asset) =>
    selectedIds.has(asset.assetId),
  );
}
