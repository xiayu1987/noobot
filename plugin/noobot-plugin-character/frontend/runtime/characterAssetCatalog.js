/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { reactive, readonly } from "vue";
import { deleteImportedAsset, listImportedAssets } from "./importedAssetStore.js";

const state = reactive({ assets: [], loading: false });
let refreshPromise = null;
let revision = 0;

export const characterAssetCatalog = readonly(state);

export async function refreshCharacterAssetCatalog() {
  if (refreshPromise) return refreshPromise;
  const requestedRevision = revision;
  state.loading = true;
  refreshPromise = listImportedAssets()
    .then((assets) => {
      if (revision === requestedRevision) state.assets = assets;
      return state.assets;
    })
    .finally(() => {
      state.loading = false;
      refreshPromise = null;
    });
  return refreshPromise;
}

export function recordCharacterAsset(asset) {
  const assetId = String(asset?.assetId || "").trim();
  if (!assetId) throw new TypeError("character asset ID is required");
  revision += 1;
  state.assets = [...state.assets.filter((item) => item.assetId !== assetId), asset].sort(
    (left, right) => left.importedAt.localeCompare(right.importedAt),
  );
}

export async function removeCharacterAsset(asset) {
  const assetId = String(asset?.assetId || "").trim();
  await deleteImportedAsset(assetId);
  revision += 1;
  state.assets = state.assets.filter((item) => item.assetId !== assetId);
}
