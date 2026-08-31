/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AnimationAssetSchema } from "../animation-protocol.js";

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

function canonicalResource(assetId, version, size) {
  return Object.freeze({
    version,
    mimeType: GLB_MIME_TYPE,
    size,
    url: `/api/internal/character/assets/${encodeURIComponent(assetId)}/${version}`,
  });
}

function parseDescriptor(req = {}) {
  const descriptor = AnimationAssetSchema.parse(req.body);
  const assetId = String(req.params?.assetId || "").trim();
  const expectedUrl = `/api/internal/character/assets/${encodeURIComponent(assetId)}/${descriptor.resource.version}`;
  if (descriptor.assetId !== assetId || descriptor.resource.url !== expectedUrl) {
    const error = new Error("character asset descriptor does not match its resource identity");
    error.statusCode = 400;
    throw error;
  }
  return descriptor;
}

export function createCharacterAssetRouteHandlers({ workspaceAssets } = {}) {
  if (
    !workspaceAssets ||
    typeof workspaceAssets.write !== "function" ||
    typeof workspaceAssets.read !== "function" ||
    typeof workspaceAssets.listMetadata !== "function" ||
    typeof workspaceAssets.writeMetadata !== "function" ||
    typeof workspaceAssets.delete !== "function"
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
        ...canonicalResource(asset.assetId, asset.version, asset.size),
      });
      res.status(201).json({ ok: true, asset: { ...asset, format: "glb", resource } });
    },
    "character.asset.commit": async (req, res) => {
      const descriptor = parseDescriptor(req);
      const resource = await workspaceAssets.read({
        userId: requestUserId(req),
        assetId: descriptor.assetId,
        version: descriptor.resource.version,
      });
      resource?.stream?.destroy?.();
      if (!resource || resource.size !== descriptor.resource.size) {
        const error = new Error("character asset resource not found");
        error.statusCode = 404;
        throw error;
      }
      const asset = await workspaceAssets.writeMetadata({
        userId: requestUserId(req),
        assetId: descriptor.assetId,
        metadata: descriptor,
      });
      res.status(201).json({ ok: true, asset });
    },
    "character.asset.list": async (req, res) => {
      const catalog = await workspaceAssets.listMetadata({ userId: requestUserId(req) });
      const assets = Object.values(catalog).map((asset) => AnimationAssetSchema.parse(asset));
      assets.sort((left, right) => left.importedAt.localeCompare(right.importedAt));
      res.status(200).json({ ok: true, assets });
    },
    "character.asset.delete": async (req, res) => {
      const result = await workspaceAssets.delete({
        userId: requestUserId(req),
        assetId: req.params.assetId,
      });
      res.status(200).json({ ok: true, ...result });
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
