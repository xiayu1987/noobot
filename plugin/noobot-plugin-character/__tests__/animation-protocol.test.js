/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createModelContext } from "@noobot/context-protocol";
import {
  compileAnimationScript,
  hasSpatiallyReachableEvents,
  analyzeAnimationSpatial,
  parseAnimationProtocol,
  safeParseAnimationProtocol,
} from "../src/animation-protocol.js";
import { createAnimationTools } from "../src/animation-tools.js";
import { compileCharacterRootMotion } from "../src/root-motion.js";
import {
  CHARACTER_ANIMATION_ARTIFACT_TYPE,
  CHARACTER_ANIMATION_TOOL_ID,
  CHARACTER_ANIMATION_UPDATE_TOOL_ID,
} from "../src/contract.js";
import { activate, injectAnimationContext } from "../src/entries/agent.js";

import { assets, generationProtocol, protocol } from "./fixtures/animation-fixtures.js";

function createTool(selectedAssets = assets) {
  const commits = [];
  const tool = createAnimationTools({
    resolveSelectedAssets: async () => selectedAssets,
    commitArtifact: async (artifact) => {
      commits.push(artifact);
      return { committed: true, eventId: `event-${commits.length}`, revision: 1 };
    },
  })[0];
  return { tool, commits };
}

test("animation protocol accepts synchronized character timelines and root transforms", () => {
  assert.equal(parseAnimationProtocol(protocol).characters.length, 2);
  const invalid = structuredClone(protocol);
  invalid.characters[1].segments[1].start = 1.5;
  assert.equal(safeParseAnimationProtocol(invalid).success, false);
  const duplicate = structuredClone(protocol);
  duplicate.characters[1].characterId = duplicate.characters[0].characterId;
  assert.equal(safeParseAnimationProtocol(duplicate).success, false);
});

test("native clips can carry synchronized absolute root motion", () => {
  const moving = structuredClone(protocol);
  moving.characters[0].segments[0].rootMotion = {
    space: "normalized_world",
    keyframes: [
      { time: 0, position: [-1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      { time: 1, position: [-0.2, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    ],
  };
  assert.equal(safeParseAnimationProtocol(moving).success, true);
  moving.characters[0].segments[0].rootMotion.keyframes[1].time = 0.9;
  assert.equal(safeParseAnimationProtocol(moving).success, false);
});

test("face_motion derives canonical -Z orientation from travel direction", () => {
  const character = {
    characterId: "walker",
    assetId: "asset.walker",
    orientationMode: "face_motion",
    rootTransform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    segments: [
      {
        type: "native_clip",
        start: 0,
        duration: 1,
        clip: "Walk",
        rootMotion: {
          space: "character_local",
          keyframes: [
            { time: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
            { time: 1, position: [1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          ],
        },
      },
    ],
  };
  const end = compileCharacterRootMotion(character).segments[0].rootMotion.keyframes[1];
  assert.ok(Math.abs(end.rotation[1] + 0.7071067811865476) < 1e-6);
  assert.ok(Math.abs(end.rotation[3] - 0.7071067811865476) < 1e-6);
});

test("authored orientation preserves backing facing", () => {
  const character = {
    characterId: "backing",
    assetId: "asset.backing",
    orientationMode: "authored",
    rootTransform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    segments: [
      {
        type: "native_clip",
        start: 0,
        duration: 1,
        clip: "Back",
        rootMotion: {
          space: "character_local",
          keyframes: [
            { time: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
            { time: 1, position: [0, 0, 1], rotation: [0, 1, 0, 0], scale: [1, 1, 1] },
          ],
        },
      },
    ],
  };
  const end = compileCharacterRootMotion(character).segments[0].rootMotion.keyframes[1];
  assert.deepEqual(end.rotation, [0, 1, 0, 0]);
});

test("attack and contact events must be spatially reachable", () => {
  const fighting = structuredClone(protocol);
  fighting.characters[0].rootTransform.position = [0, 0, 0];
  fighting.characters[1].rootTransform.position = [10, 0, 0];
  fighting.scene.collisionSpace.colliders = [
    {
      colliderId: "robot-hitbox",
      characterId: "character-1",
      node: null,
      role: "hitbox",
      shape: { type: "sphere", center: [0, 0, 0], radius: 0.2 },
    },
    {
      colliderId: "target-hurtbox",
      characterId: "character-2",
      node: null,
      role: "hurtbox",
      shape: { type: "box", center: [0, 0, 0], size: [0.5, 1, 0.5] },
    },
  ];
  fighting.events = [
    {
      eventId: "strike",
      type: "attack",
      time: 0.5,
      attackerId: "character-1",
      targetId: "character-2",
      hitboxId: "robot-hitbox",
      hurtboxId: "target-hurtbox",
    },
  ];
  assert.equal(safeParseAnimationProtocol(fighting).success, true);
  assert.equal(hasSpatiallyReachableEvents(parseAnimationProtocol(fighting)), false);
  fighting.characters[1].rootTransform.position = [0.4, 0, 0];
  for (const frame of fighting.characters[1].segments[0].rootMotion.keyframes)
    frame.position = [0.4, 0, 0];
  for (const frame of fighting.characters[1].segments[1].rootMotion.keyframes)
    frame.position = [0.4, 0, 0];
  assert.equal(hasSpatiallyReachableEvents(parseAnimationProtocol(fighting)), true);
});

test("node-bound attack events allow conservative animated limb reach", () => {
  const fighting = structuredClone(protocol);
  fighting.characters[0].rootTransform.position = [0, 0, 0];
  fighting.characters[1].rootTransform.position = [1.6, 0, 0];
  for (const frame of fighting.characters[0].segments.flatMap(
    (segment) => segment.rootMotion.keyframes,
  ))
    frame.position = [0, 0, 0];
  for (const frame of fighting.characters[1].segments.flatMap(
    (segment) => segment.rootMotion.keyframes,
  ))
    frame.position = [1.6, 0, 0];
  fighting.scene.collisionSpace.colliders = [
    {
      colliderId: "robot-fist",
      characterId: "character-1",
      node: "Head",
      role: "hitbox",
      shape: { type: "sphere", center: [0, 0, 0], radius: 0.14 },
    },
    {
      colliderId: "soldier-torso",
      characterId: "character-2",
      node: "Head",
      role: "hurtbox",
      shape: { type: "box", center: [0, 0, 0], size: [0.5, 1, 0.5] },
    },
  ];
  fighting.events = [
    {
      eventId: "strike",
      type: "attack",
      time: 0.5,
      attackerId: "character-1",
      targetId: "character-2",
      hitboxId: "robot-fist",
      hurtboxId: "soldier-torso",
    },
  ];
  assert.equal(hasSpatiallyReachableEvents(parseAnimationProtocol(fighting)), true);
  fighting.characters[1].rootTransform.position = [10, 0, 0];
  for (const frame of fighting.characters[1].segments.flatMap(
    (segment) => segment.rootMotion.keyframes,
  ))
    frame.position = [10, 0, 0];
  assert.equal(hasSpatiallyReachableEvents(parseAnimationProtocol(fighting)), false);
});

test("spatial diagnostics apply root rotation/scale and expose displacement", () => {
  const value = structuredClone(protocol);
  value.characters[0].rootTransform = {
    position: [1, 0, 0],
    rotation: [0, 0, Math.sqrt(0.5), Math.sqrt(0.5)],
    scale: [2, 2, 2],
  };
  value.characters[1].rootTransform.position = [1, 2, 0];
  value.characters[0].segments.forEach((segment) => {
    segment.rootMotion?.keyframes.forEach((frame) => {
      frame.position = [1, 0, 0];
      frame.rotation = [0, 0, Math.sqrt(0.5), Math.sqrt(0.5)];
      frame.scale = [2, 2, 2];
    });
  });
  value.characters[1].segments.forEach((segment) => {
    segment.rootMotion?.keyframes.forEach((frame) => {
      frame.position = [1, 2, 0];
    });
  });
  value.scene.collisionSpace.colliders = [
    {
      colliderId: "a",
      characterId: "character-1",
      node: null,
      role: "solid",
      shape: { type: "sphere", center: [1, 0, 0], radius: 0.1 },
    },
    {
      colliderId: "b",
      characterId: "character-2",
      node: null,
      role: "solid",
      shape: { type: "sphere", center: [0, 0, 0], radius: 0.1 },
    },
  ];
  const diagnostics = analyzeAnimationSpatial(value);
  assert.equal(diagnostics.units, "normalized_world");
  assert.equal(diagnostics.characters["character-1"].displacement, 0);
  // [1, 0, 0] rotated in the XY plane by 90 degrees and scaled by 2 => [0, 2, 0].
  assert.ok(diagnostics.characters["character-1"].minClearance < 0);
});

test("collision protocol accepts capsule colliders", () => {
  const value = structuredClone(protocol);
  value.characters = [value.characters[0]];
  value.scene.collisionSpace.colliders = [
    {
      colliderId: "capsule-solid",
      characterId: "character-1",
      node: null,
      role: "solid",
      shape: { type: "capsule", center: [0, 0.5, 0], radius: 0.2, halfHeight: 0.3 },
    },
  ];
  assert.equal(safeParseAnimationProtocol(value).success, true);
});

test("spatial diagnostics keep root colliders in canonical units", () => {
  const value = structuredClone(protocol);
  value.characters = [value.characters[0]];
  value.characters[0].segments = [
    {
      type: "native_clip",
      start: 0,
      duration: 1,
      clip: "Walking",
      rootMotion: {
        space: "normalized_world",
        keyframes: [
          { time: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          { time: 1, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        ],
      },
    },
  ];
  value.scene.collisionSpace.colliders = [
    {
      colliderId: "root",
      characterId: "character-1",
      node: null,
      role: "solid",
      shape: { type: "sphere", center: [0, 0, 0], radius: 0.1 },
    },
  ];
  const diagnostics = analyzeAnimationSpatial(value);
  assert.equal(diagnostics.characters["character-1"].minClearance, null);
  assert.equal(diagnostics.characters["character-1"].distance, 0);
});

test("node resolver supplies animated world-space collider transforms", () => {
  const value = structuredClone(protocol);
  value.characters = [value.characters[0]];
  value.characters[0].segments = [
    {
      type: "native_clip",
      start: 0,
      duration: 1,
      clip: "Walking",
      rootMotion: {
        space: "normalized_world",
        keyframes: [
          { time: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          { time: 1, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        ],
      },
    },
  ];
  value.scene.collisionSpace.colliders = [
    {
      colliderId: "node-a",
      characterId: "character-1",
      node: "Hand",
      role: "solid",
      shape: { type: "sphere", center: [0, 0, 0], radius: 0.1 },
    },
  ];
  const diagnostics = analyzeAnimationSpatial(value, {
    resolveColliderNode: () => ({
      position: [2, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    }),
  });
  assert.equal(diagnostics.characters["character-1"].distance, 0);
  assert.equal(diagnostics.characters["character-1"].minClearance, null);
});

test("swept diagnostics catch a collision between sampled frames", () => {
  const value = structuredClone(protocol);
  value.duration = 1;
  value.characters = value.characters.map((character, index) => ({
    ...character,
    segments: [
      {
        type: "native_clip",
        start: 0,
        duration: 1,
        clip: "Walking",
        rootMotion: {
          space: "normalized_world",
          keyframes: [
            {
              time: 0,
              position: index ? [1, 0, 0] : [-1, 0, 0],
              rotation: [0, 0, 0, 1],
              scale: [1, 1, 1],
            },
            {
              time: 1,
              position: index ? [-1, 0, 0] : [1, 0, 0],
              rotation: [0, 0, 0, 1],
              scale: [1, 1, 1],
            },
          ],
        },
      },
    ],
  }));
  value.scene.collisionSpace.colliders = value.characters.map((character, index) => ({
    colliderId: `solid-${index}`,
    characterId: character.characterId,
    node: null,
    role: "solid",
    shape: { type: "sphere", center: [0, 0, 0], radius: 0.1 },
  }));
  const diagnostics = analyzeAnimationSpatial(value);
  assert.ok(diagnostics.penetrationIntervals.length > 0);
  assert.ok(diagnostics.characters["character-1"].minClearance < 0);
});

test("character context is absent without a selection and injected once with exact metadata", async (t) => {
  const modelContext = createModelContext({
    messageBlocks: { system: [], history: [], incremental: [] },
  });
  const context = { modelContext };
  assert.equal(await injectAnimationContext(context, {}), false);
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-character-context-"));
  t.after(() => fs.rm(basePath, { recursive: true, force: true }));
  const catalogDir = path.join(basePath, "runtime/plugin-assets/character");
  await fs.mkdir(catalogDir, { recursive: true });
  await fs.writeFile(
    path.join(catalogDir, "catalog.json"),
    JSON.stringify(Object.fromEntries(assets.map((asset) => [asset.assetId, asset]))),
  );
  const config = {
    basePath,
    selectedCharacterAssetIds: assets.map((asset) => asset.assetId),
  };
  assert.equal(await injectAnimationContext(context, config), true);
  assert.equal(await injectAnimationContext(context, config), false);
  assert.match(String(modelContext.messageBlocks.system[0].content), /get before update/);
  assert.match(String(modelContext.messageBlocks.system[0].content), /Walking/);
  assert.match(String(modelContext.messageBlocks.system[0].content), /type:"channel"/);
});

test("the animation tool validates every selected character reference", async () => {
  const unselected = createTool([assets[0]]).tool;
  const missing = JSON.parse(await unselected.invoke({ protocol: generationProtocol }));
  assert.deepEqual(
    { code: missing.code, assetId: missing.assetId },
    { code: "ANIMATION_ASSET_NOT_SELECTED", assetId: assets[1].assetId },
  );
  const unknownClip = structuredClone(generationProtocol);
  unknownClip.characters[1].segments[0].clip = "Flying";
  const result = JSON.parse(await createTool().tool.invoke({ protocol: unknownClip }));
  assert.deepEqual(
    { code: result.code, assetId: result.assetId },
    { code: "ANIMATION_CLIP_NOT_IN_ASSET", assetId: assets[1].assetId },
  );
});

test("the tool preserves a supplied animation ID and returns authoritative identity", async () => {
  const { tool, commits } = createTool();
  const result = JSON.parse(await tool.invoke({ protocol: generationProtocol }));
  assert.equal(result.ok, true);
  assert.equal(result.animationId, protocol.animationId);
  assert.deepEqual(
    result.characterAssetIds,
    assets.map((asset) => asset.assetId),
  );
  assert.equal(Object.hasOwn(result, "protocol"), false);
  assert.deepEqual(
    { artifactType: commits[0].artifactType, artifactId: commits[0].artifactId },
    {
      artifactType: CHARACTER_ANIMATION_ARTIFACT_TYPE,
      artifactId: protocol.animationId,
    },
  );
});

test("the tool creates and returns an animation ID when the model omits it", async () => {
  const { animationId: _animationId, ...withoutId } = generationProtocol;
  const { tool, commits } = createTool();
  const result = JSON.parse(await tool.invoke({ protocol: withoutId }));
  assert.equal(result.ok, true);
  assert.match(result.animationId, /^animation\.[a-f0-9]{32}$/);
  assert.equal(commits[0].data.protocol.animationId, result.animationId);
});

test("the registered tool commits through the declared artifact port", async (t) => {
  const registeredFactories = new Map();
  const commits = [];
  const agentContext = { protocolVersion: 1 };
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-character-tool-"));
  t.after(() => fs.rm(basePath, { recursive: true, force: true }));
  const catalogDir = path.join(basePath, "runtime/plugin-assets/character");
  await fs.mkdir(catalogDir, { recursive: true });
  await fs.writeFile(
    path.join(catalogDir, "catalog.json"),
    JSON.stringify(Object.fromEntries(assets.map((asset) => [asset.assetId, asset]))),
  );
  const activation = activate(
    {
      hooks: { register: () => () => undefined },
      artifacts: {
        commit: async (artifact, toolContext) => {
          commits.push({ artifact, toolContext });
          return { committed: true, eventId: "event-1", revision: 1 };
        },
        get: async () => ({ found: false, artifact: null, revision: 0 }),
      },
      tools: {
        register: (id, factory) => {
          registeredFactories.set(id, factory);
          return { dispose() {} };
        },
      },
    },
    {
      selectedCharacterAssetIds: assets.map((asset) => asset.assetId),
      basePath,
    },
  );
  const tool = registeredFactories.get(CHARACTER_ANIMATION_TOOL_ID)({ agentContext });
  const result = JSON.parse(
    await tool.invoke({
      protocol: {
        ...generationProtocol,
        scene: generationProtocol.scene,
        characters: [generationProtocol.characters[0]],
      },
    }),
  );
  activation.dispose();
  assert.equal(result.ok, true);
  assert.equal(commits[0].artifact.artifactType, CHARACTER_ANIMATION_ARTIFACT_TYPE);
  assert.equal(commits[0].toolContext.agentContext, agentContext);
});

test("update replaces an animation with an atomic base revision", async () => {
  const replacements = [];
  const updateTool = createAnimationTools({
    resolveSelectedAssets: async () => assets,
    commitArtifact: async (artifact) => {
      replacements.push(artifact);
      return { committed: true, eventId: "replace-1", revision: 4 };
    },
  }).find((tool) => tool.name === CHARACTER_ANIMATION_UPDATE_TOOL_ID);
  const { animationId: _animationId, ...protocolBody } = protocol;
  const result = JSON.parse(
    await updateTool.invoke({
      animationId: protocol.animationId,
      baseRevision: 3,
      protocol: protocolBody,
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(replacements[0].baseRevision, 3);
  assert.equal(replacements[0].data.protocol.animationId, protocol.animationId);
});
