/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const GLB_MIME_TYPE = "model/gltf-binary";

function requestUserId(req = {}) {
  const userId = String(req?.auth?.userId || "").trim();
  if (!userId) {
    const error = new Error("authenticated character asset user is required");
    error.statusCode = 401;
    throw error;
  }
  return userId;
}

function validateGlb({ prefix, size }) {
  if (prefix.length < 12 || prefix.toString("ascii", 0, 4) !== "glTF") {
    const error = new Error("character asset must be a binary GLB file");
    error.statusCode = 400;
    throw error;
  }
  if (prefix.readUInt32LE(4) !== 2 || prefix.readUInt32LE(8) !== size) {
    const error = new Error("character asset has an invalid GLB v2 header");
    error.statusCode = 400;
    throw error;
  }
}

function requireGlbContentType(req = {}) {
  const contentType = String(req.headers?.["content-type"] || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== GLB_MIME_TYPE) {
    const error = new Error(`character asset content type must be ${GLB_MIME_TYPE}`);
    error.statusCode = 415;
    throw error;
  }
}

export function createCharacterAssetRouteHandlers({ workspaceAssets } = {}) {
  if (
    !workspaceAssets ||
    typeof workspaceAssets.write !== "function" ||
    typeof workspaceAssets.read !== "function"
  ) {
    throw new Error("character service workspace asset port is required");
  }
  return {
    "character.asset.write": async (req, res) => {
      requireGlbContentType(req);
      const asset = await workspaceAssets.write({
        userId: requestUserId(req),
        assetId: req.params.assetId,
        source: req,
        declaredBytes: Number(req.headers?.["content-length"] || 0),
        validate: validateGlb,
      });
      const resource = Object.freeze({
        version: asset.version,
        mimeType: GLB_MIME_TYPE,
        size: asset.size,
        url: `/api/internal/character/assets/${encodeURIComponent(asset.assetId)}/${asset.version}`,
      });
      res.status(201).json({ ok: true, asset: { ...asset, format: "glb", resource } });
    },
    "character.asset.read": async (req, res) => {
      const asset = await workspaceAssets.read({
        userId: requestUserId(req),
        assetId: req.params.assetId,
        version: req.params.version,
      });
      if (!asset) {
        const error = new Error("character asset not found");
        error.statusCode = 404;
        throw error;
      }
      res.status(200);
      res.setHeader("Content-Type", GLB_MIME_TYPE);
      res.setHeader("Content-Length", asset.size);
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      await new Promise((resolve, reject) => {
        asset.stream.on("error", reject);
        res.on("finish", resolve);
        res.on("close", resolve);
        asset.stream.pipe(res);
      });
    },
  };
}
