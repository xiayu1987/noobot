/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { compileCameraPlan, listCameraPresets } from "../src/camera-preset-compiler.js";
import { AnimationProtocolSchema } from "../src/animation-protocol.js";
import { createAnimationTools } from "../src/animation-tools.js";
import {
  CHARACTER_ANIMATION_CAMERA_APPLY_TOOL_ID,
  CHARACTER_CAMERA_PRESET_LIST_TOOL_ID,
} from "../src/contract.js";

const asset = {
  assetId: "user.glb.robot",
  name: "robot.glb",
  format: "glb",
  size: 12,
  animations: [{ name: "Walking", duration: 2, tracks: 1 }],
  nodes: ["Root"],
  bounds: { min: [-0.5, 0, -0.3], max: [0.5, 1, 0.3], height: 1 },
  sourceUnit: "meter",
  canonicalUnit: "normalized_world",
  anchor: "foot_center",
  axes: { handedness: "right", up: "Y", forward: "-Z" },
  normalization: { targetHeight: 1, scale: 1, floorOffset: 0, anchorOffset: [0, 0, 0] },
  importedAt: "2026-08-31T00:00:00.000Z",
  resource: {
    version: "a".repeat(64),
    mimeType: "model/gltf-binary",
    size: 12,
    url: `/api/internal/character/assets/user.glb.robot/${"a".repeat(64)}`,
  },
};
const character = {
  characterId: "fighter.left",
  assetId: asset.assetId,
  rootTransform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  segments: [
    {
      type: "native_clip",
      start: 0,
      duration: 2,
      clip: "Walking",
      rootMotion: {
        space: "normalized_world",
        keyframes: [
          { time: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          { time: 2, position: [2, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        ],
      },
    },
  ],
};
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
};
const protocol = {
  format: "noobot.animation.protocol",
  version: 4,
  animationId: "animation.camera-test",
  duration: 2,
  loop: false,
  scene: {
    ...scene,
    contactConstraints: [],
    cameraTrack: compileCameraPlan({
      camera: { presetId: "camera.static.wide" },
      duration: 2,
      characters: [character],
    }),
  },
  characters: [character],
  events: [],
};

test("all sixteen built-in camera presets compile to authoritative v4 tracks", () => {
  const presets = listCameraPresets();
  assert.equal(presets.length, 16);
  assert.equal(new Set(presets.map((item) => item.presetId)).size, 16);
  for (const preset of presets) {
    const cameraTrack = compileCameraPlan({
      camera: { presetId: preset.presetId, subjectIds: [character.characterId] },
      duration: 2,
      characters: [character],
      groundY: 0,
    });
    const parsed = AnimationProtocolSchema.parse({
      ...protocol,
      scene: { ...scene, cameraTrack },
    });
    assert.equal(parsed.scene.cameraTrack.keyframes[0].time, 0);
    assert.equal(parsed.scene.cameraTrack.keyframes.at(-1).time, 2);
    assert.ok(
      parsed.scene.cameraTrack.keyframes.every(
        (frame) => frame.position[1] >= scene.groundY + 0.15,
      ),
    );
  }
});

test("default wide camera frames canonical -Z character fronts", () => {
  const cameraTrack = compileCameraPlan({
    camera: { presetId: "camera.static.wide", subjectIds: [character.characterId] },
    duration: 2,
    characters: [character],
    groundY: 0,
  });
  assert.ok(cameraTrack.keyframes[0].position[2] < cameraTrack.keyframes[0].target[2]);
});

test("camera shot plans require continuous coverage and preserve explicit cuts", () => {
  const cameraTrack = compileCameraPlan({
    camera: {
      shots: [
        {
          presetId: "camera.static.wide",
          start: 0,
          duration: 1,
          transition: "cut",
        },
        {
          presetId: "camera.orbit.clockwise",
          start: 1,
          duration: 1,
          transition: "cut",
        },
      ],
    },
    duration: 2,
    characters: [character],
  });
  const boundary = cameraTrack.keyframes.filter((frame) => frame.time === 1);
  assert.equal(boundary.length, 2);
  assert.equal(boundary[1].transition, "cut");
  assert.doesNotThrow(() =>
    AnimationProtocolSchema.parse({ ...protocol, scene: { ...scene, cameraTrack } }),
  );
  assert.throws(
    () =>
      compileCameraPlan({
        camera: {
          shots: [
            {
              presetId: "camera.static.wide",
              start: 0,
              duration: 0.5,
              transition: "cut",
            },
          ],
        },
        duration: 2,
        characters: [character],
      }),
    /continuously cover/,
  );
});

test("camera preset tools list IDs and replace the authoritative animation camera", async () => {
  const commits = [];
  const tools = createAnimationTools({
    resolveSelectedAssets: async () => [asset],
    getArtifact: async () => ({
      found: true,
      revision: 3,
      artifact: { protocol, assets: [asset] },
    }),
    commitArtifact: async (artifact) => {
      commits.push(artifact);
      return { committed: true, eventId: "camera-event", revision: 4 };
    },
  });
  const listTool = tools.find((item) => item.name === CHARACTER_CAMERA_PRESET_LIST_TOOL_ID);
  const listed = JSON.parse(await listTool.invoke({}));
  assert.equal(listed.presets.length, 16);

  const applyTool = tools.find((item) => item.name === CHARACTER_ANIMATION_CAMERA_APPLY_TOOL_ID);
  const result = JSON.parse(
    await applyTool.invoke({
      animationId: protocol.animationId,
      baseRevision: 3,
      presetId: "camera.follow.side",
      subjectIds: [character.characterId],
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.revision, 4);
  assert.equal(commits[0].operation, "replaced");
  assert.equal(commits[0].baseRevision, 3);
  assert.deepEqual(commits[0].data.assets, [asset]);
  assert.notDeepEqual(commits[0].data.protocol.scene.cameraTrack, protocol.scene.cameraTrack);
  assert.equal(Object.hasOwn(commits[0].data.protocol.scene, "camera"), false);
});
