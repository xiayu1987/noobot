/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";

export const PERF_PLUGIN_TOOLS = Object.freeze([
  "character_animation_generate",
  "character_animation_get",
  "character_animation_update",
  "character_camera_preset_list",
  "character_animation_camera_apply",
  "character_animation_script",
]);

export function characterSteps(filePath, repetition = 0) {
  const animationId = `animation.${createHash("sha256").update(`${filePath}:${repetition}`).digest("hex").slice(0, 32)}`;
  const scene = {
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
  };
  const character = {
    characterId: "robot",
    assetId: "sample.three.robot-expressive",
    rootTransform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    orientationMode: "auto",
    segments: [
      {
        type: "native_clip",
        start: 0,
        duration: 2,
        clip: "Wave",
        rootMotion: {
          space: "normalized_world",
          keyframes: [0, 2].map((time) => ({
            time,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1],
          })),
        },
      },
    ],
  };
  const protocol = {
    format: "noobot.animation.protocol",
    version: 4,
    duration: 2,
    loop: false,
    scene: { ...scene, camera: { presetId: "camera.static.wide" } },
    characters: [character],
    events: [],
  };
  const cameraTrack = {
    type: "keyframes",
    positionInterpolation: "catmull_rom_centripetal",
    targetInterpolation: "catmull_rom_centripetal",
    fovInterpolation: "cubic",
    keyframes: [0, 2].map((time) => ({
      time,
      position: [0, 1, 5],
      target: [0, 0.5, 0],
      fov: 40,
      transition: "blend",
      easing: "ease_in_out",
    })),
  };
  return [
    {
      name: PERF_PLUGIN_TOOLS[0],
      args: {
        protocol: {
          ...protocol,
          animationId,
          characters: [
            {
              ...character,
              segments: character.segments.map((segment) => ({
                ...segment,
                rootMotion: { ...segment.rootMotion, space: "character_local" },
              })),
            },
          ],
        },
      },
    },
    { name: PERF_PLUGIN_TOOLS[1], args: { animationId } },
    {
      name: PERF_PLUGIN_TOOLS[2],
      args: {
        animationId,
        baseRevision: 1,
        protocol: { ...protocol, scene: { ...scene, cameraTrack } },
      },
    },
    { name: PERF_PLUGIN_TOOLS[3], args: {} },
    {
      name: PERF_PLUGIN_TOOLS[4],
      args: { animationId, baseRevision: 2, presetId: "camera.static.wide" },
    },
    {
      name: PERF_PLUGIN_TOOLS[5],
      args: {
        script: {
          format: "noobot.animation.script",
          version: 1,
          loop: false,
          scene: protocol.scene,
          characters: [
            {
              characterId: character.characterId,
              assetId: character.assetId,
              rootTransform: character.rootTransform,
            },
          ],
          root: {
            type: "sequence",
            steps: [{ type: "clip", characterId: "robot", clip: "Wave", duration: 2 }],
          },
        },
      },
    },
  ];
}
