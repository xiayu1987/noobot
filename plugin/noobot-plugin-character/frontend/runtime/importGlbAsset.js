/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as THREE from "three";
import { saveImportedAsset } from "./importedAssetStore.js";

export async function importGlbAsset({ blob, name, assetId, canonicalRotation = [0, 0, 0, 1] }) {
  if (!(blob instanceof Blob)) throw new TypeError("GLB import requires a Blob");
  const resolvedAssetId = String(assetId || "").trim();
  if (!resolvedAssetId) throw new TypeError("GLB import requires an asset ID");
  const objectUrl = URL.createObjectURL(blob);
  try {
    const gltf = await new GLTFLoader().loadAsync(objectUrl);
    const nodes = [];
    gltf.scene.traverse((node) => {
      const nodeName = String(node?.name || "").trim();
      if (nodeName) nodes.push(nodeName);
    });
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    const min = bounds.min.toArray();
    const max = bounds.max.toArray();
    const height = max[1] - min[1];
    if (!(height > 0)) throw new Error("GLB model must have a positive height");
    const targetHeight = 1;
    return saveImportedAsset(
      {
        assetId: resolvedAssetId,
        name: String(name || "character.glb").trim() || "character.glb",
        format: "glb",
        size: blob.size,
        animations: (gltf.animations || []).map((clip) => ({
          name: String(clip.name || "").trim(),
          duration: Number(clip.duration.toFixed(4)),
          tracks: clip.tracks.length,
        })),
        nodes: [...new Set(nodes)].slice(0, 500),
        bounds: { min, max, height },
        sourceUnit: "meter",
        metersPerUnit: 1,
        heightMeters: height,
        canonicalUnit: "normalized_world",
        anchor: "foot_center",
        axes: { handedness: "right", up: "Y", forward: "-Z" },
        canonicalRotation,
        normalization: {
          targetHeight,
          scale: targetHeight / height,
          floorOffset: (-min[1] * targetHeight) / height,
          anchorOffset: [
            (-(min[0] + max[0]) * 0.5 * targetHeight) / height,
            0,
            (-(min[2] + max[2]) * 0.5 * targetHeight) / height,
          ],
        },
        importedAt: new Date().toISOString(),
      },
      blob,
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
