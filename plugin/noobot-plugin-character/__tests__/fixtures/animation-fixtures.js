/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export const assets = ["robot-a", "robot-b"].map((name) => ({
  assetId: `user.glb.${name}`,
  name: `${name}.glb`,
  format: "glb",
  size: 12,
  animations: [{ name: "Walking", duration: 1.2, tracks: 42 }],
  nodes: ["Head"],
  bounds: { min: [0, 0, 0], max: [1, 1, 1], height: 1 },
  sourceUnit: "meter",
  canonicalUnit: "normalized_world",
  anchor: "foot_center",
  axes: { handedness: "right", up: "Y", forward: "-Z" },
  normalization: { targetHeight: 1, scale: 1, floorOffset: 0, anchorOffset: [0, 0, 0] },
  importedAt: "2026-08-29T00:00:00.000Z",
  resource: {
    version: "a".repeat(64),
    mimeType: "model/gltf-binary",
    size: 12,
    url: `/api/internal/character/assets/user.glb.${name}/${"a".repeat(64)}`,
  },
}));
export const protocol = {
  format: "noobot.animation.protocol",
  version: 4,
  animationId: "walk-and-nod",
  duration: 2,
  loop: false,
  scene: {
    coordinateSystem: "normalized_world",
    unitHeight: 1,
    groundY: 0,
    collisionSpace: {
      units: "normalized_world",
      origin: [0, 0, 0],
      detection: "continuous",
      colliders: [],
    },
    contactConstraints: [],
    cameraTrack: {
      type: "keyframes",
      positionInterpolation: "catmull_rom_centripetal",
      targetInterpolation: "catmull_rom_centripetal",
      fovInterpolation: "cubic",
      keyframes: [
        {
          time: 0,
          position: [0, 1, 5],
          target: [0, 0.5, 0],
          fov: 40,
          transition: "blend",
          easing: "ease_in_out",
        },
        {
          time: 2,
          position: [0, 1, 5],
          target: [0, 0.5, 0],
          fov: 40,
          transition: "blend",
          easing: "ease_in_out",
        },
      ],
    },
  },
  characters: assets.map((asset, index) => ({
    characterId: `character-${index + 1}`,
    assetId: asset.assetId,
    rootTransform: { position: [index * 2, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    segments: [
      { type: "native_clip", start: 0, duration: 1, clip: "Walking" },
      {
        type: "keyframes",
        start: 1,
        duration: 1,
        tracks: [
          {
            node: "Head",
            property: "rotation",
            keyframes: [
              { time: 0, rotation: [0, 0, 0, 1] },
              { time: 1, rotation: [0, 0.2, 0, 0.98] },
            ],
          },
        ],
      },
    ],
  })),
  events: [],
};
export const generationProtocol = {
  ...protocol,
  characters: protocol.characters.map((character) => ({
    ...character,
    segments: character.segments.map((segment) => ({
      ...segment,
      rootMotion: {
        ...(segment.rootMotion || {
          space: "normalized_world",
          keyframes: [
            {
              time: 0,
              position: character.rootTransform.position,
              rotation: character.rootTransform.rotation,
              scale: character.rootTransform.scale,
            },
            {
              time: segment.duration,
              position: character.rootTransform.position,
              rotation: character.rootTransform.rotation,
              scale: character.rootTransform.scale,
            },
          ],
        }),
        space: "character_local",
        keyframes: (
          segment.rootMotion?.keyframes || [
            {
              time: 0,
              position: character.rootTransform.position,
              rotation: character.rootTransform.rotation,
              scale: character.rootTransform.scale,
            },
            {
              time: segment.duration,
              position: character.rootTransform.position,
              rotation: character.rootTransform.rotation,
              scale: character.rootTransform.scale,
            },
          ]
        ).map((frame) => ({
          ...frame,
          position: frame.position.map(
            (value, index) => value - character.rootTransform.position[index],
          ),
        })),
      },
    })),
  })),
  scene: {
    coordinateSystem: protocol.scene.coordinateSystem,
    unitHeight: protocol.scene.unitHeight,
    groundY: protocol.scene.groundY,
    collisionSpace: protocol.scene.collisionSpace,
    camera: { presetId: "camera.static.wide" },
  },
};

for (const character of protocol.characters) {
  for (const segment of character.segments) {
    if (!segment.rootMotion) {
      segment.rootMotion = {
        space: "normalized_world",
        keyframes: [
          {
            time: 0,
            position: character.rootTransform.position,
            rotation: character.rootTransform.rotation,
            scale: character.rootTransform.scale,
          },
          {
            time: segment.duration,
            position: character.rootTransform.position,
            rotation: character.rootTransform.rotation,
            scale: character.rootTransform.scale,
          },
        ],
      };
    }
  }
}
