/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const IDENTITY_ROTATION = [0, 0, 0, 1];
const CANONICAL_AXES = Object.freeze({ handedness: "right", up: "Y", forward: "-Z" });

function isLegacyAssetDescriptor(value = {}) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !Object.hasOwn(value, "sourceUnit") &&
    !Object.hasOwn(value, "canonicalUnit") &&
    !Object.hasOwn(value, "anchor") &&
    !Object.hasOwn(value, "axes") &&
    value.normalization &&
    typeof value.normalization === "object" &&
    Number.isFinite(value.bounds?.height) &&
    Number.isFinite(value.normalization.targetHeight) &&
    Number.isFinite(value.normalization.scale) &&
    Number.isFinite(value.normalization.floorOffset)
  );
}

export function migrateLegacyAssetDescriptor(value = {}) {
  if (!isLegacyAssetDescriptor(value)) return null;
  return {
    ...value,
    sourceUnit: "meter",
    metersPerUnit: 1,
    heightMeters: value.bounds.height,
    canonicalUnit: "normalized_world",
    anchor: "foot_center",
    axes: CANONICAL_AXES,
    canonicalRotation: IDENTITY_ROTATION,
    normalization: {
      ...value.normalization,
      anchorOffset: value.normalization.anchorOffset || [0, 0, 0],
    },
  };
}
