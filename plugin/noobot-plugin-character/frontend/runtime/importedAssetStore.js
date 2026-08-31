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
function requireService() {
  if (typeof authenticatedRequest !== "function") {
    throw new Error("character asset service is unavailable");
  }
  return authenticatedRequest;
}

async function responsePayload(response, failure) {
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error || `${failure}: ${response.status}`);
  }
  return payload;
}

async function cacheBlob(asset, blob) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const request = db
        .transaction(STORE, "readwrite")
        .objectStore(STORE)
        .put({ cacheKey: `${asset.assetId}:${asset.resource.version}`, blob });
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function deleteCachedAsset(assetId) {
  const prefix = `${assetId}:`;
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        if (String(cursor.key).startsWith(prefix)) cursor.delete();
        cursor.continue();
      };
    });
  } finally {
    db.close();
  }
}

export async function listImportedAssets() {
  const response = await requireService()("/api/internal/character/assets", { method: "GET" });
  const payload = await responsePayload(response, "character asset catalog load failed");
  if (!Array.isArray(payload.assets)) throw new Error("character asset catalog is invalid");
  return payload.assets;
}

export async function saveImportedAsset(metadata, blob) {
  const assetId = String(metadata?.assetId || "").trim();
  if (!assetId || !(blob instanceof Blob)) {
    throw new TypeError("imported GLB requires asset metadata and a Blob");
  }
  const response = await requireService()(
    `/api/internal/character/assets/${encodeURIComponent(assetId)}`,
    {
      method: "PUT",
      headers: { "content-type": "model/gltf-binary" },
      body: blob,
    },
  );
  const payload = await responsePayload(response, "character asset upload failed");
  if (!payload?.asset?.resource) throw new Error("character asset upload response is invalid");
  const descriptor = Object.freeze({
    ...metadata,
    assetId: payload.asset.assetId,
    format: payload.asset.format,
    size: payload.asset.size,
    resource: Object.freeze({ ...payload.asset.resource }),
  });
  const commitResponse = await requireService()(
    `/api/internal/character/assets/${encodeURIComponent(assetId)}/descriptor`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(descriptor),
    },
  );
  const committed = await responsePayload(commitResponse, "character asset commit failed");
  if (!committed?.asset) throw new Error("character asset commit response is invalid");
  await cacheBlob(committed.asset, blob);
  return committed.asset;
}

export async function deleteImportedAsset(asset = {}) {
  const assetId = String(asset?.assetId || asset || "").trim();
  if (!assetId) throw new TypeError("character asset ID is required");
  const response = await requireService()(
    `/api/internal/character/assets/${encodeURIComponent(assetId)}`,
    { method: "DELETE" },
  );
  const result = await responsePayload(response, "character asset deletion failed");
  await deleteCachedAsset(assetId);
  return result;
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
    const response = await requireService()(resourceUrl, { method: "GET" });
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
