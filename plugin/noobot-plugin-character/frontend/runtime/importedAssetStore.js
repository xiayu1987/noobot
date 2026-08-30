/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const DB = "noobot-character-assets-v2";
const STORE = "glb";
let authenticatedRequest = null;

export function configureImportedAssetStore({ request } = {}) {
  if (typeof request !== "function") {
    throw new TypeError("character asset store requires authenticated request capability");
  }
  authenticatedRequest = request;
}

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "cacheKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveImportedAsset(metadata, blob) {
  const assetId = String(metadata?.assetId || "").trim();
  if (!assetId || !(blob instanceof Blob)) {
    throw new TypeError("imported GLB requires asset metadata and a Blob");
  }
  if (typeof authenticatedRequest !== "function") {
    throw new Error("character asset service is unavailable");
  }
  const response = await authenticatedRequest(
    `/api/internal/character/assets/${encodeURIComponent(assetId)}`,
    {
      method: "PUT",
      headers: { "content-type": "model/gltf-binary" },
      body: blob,
    },
  );
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true || !payload?.asset?.resource) {
    throw new Error(payload?.error || `character asset upload failed: ${response.status}`);
  }
  const canonical = Object.freeze({
    ...metadata,
    assetId: payload.asset.assetId,
    format: payload.asset.format,
    size: payload.asset.size,
    resource: Object.freeze({ ...payload.asset.resource }),
  });
  const db = await database();
  await new Promise((resolve, reject) => {
    const request = db
      .transaction(STORE, "readwrite")
      .objectStore(STORE)
      .put({ cacheKey: `${assetId}:${canonical.resource.version}`, blob });
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
  return canonical;
}
export async function loadImportedAsset(asset = {}) {
  const assetId = String(asset?.assetId || "").trim();
  const version = String(asset?.resource?.version || "").trim();
  const resourceUrl = String(asset?.resource?.url || "").trim();
  if (!assetId || !version || !resourceUrl) {
    throw new TypeError("character asset requires canonical resource metadata");
  }
  const cacheKey = `${assetId}:${version}`;
  const db = await database();
  let value = await new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(cacheKey);
    request.onsuccess = () => resolve(request.result?.blob || null);
    request.onerror = () => reject(request.error);
  });
  if (value && value.size !== asset.resource.size) {
    await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(cacheKey);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    value = null;
  }
  if (!value) {
    if (typeof authenticatedRequest !== "function") {
      db.close();
      throw new Error("character asset service is unavailable");
    }
    const response = await authenticatedRequest(resourceUrl, { method: "GET" });
    if (!response.ok) {
      db.close();
      throw new Error(`character asset download failed: ${response.status}`);
    }
    value = await response.blob();
    if (value.size !== asset.resource.size) {
      db.close();
      throw new Error("character asset download size mismatch");
    }
    await new Promise((resolve, reject) => {
      const request = db
        .transaction(STORE, "readwrite")
        .objectStore(STORE)
        .put({ cacheKey, blob: value });
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  }
  db.close();
  return value;
}
