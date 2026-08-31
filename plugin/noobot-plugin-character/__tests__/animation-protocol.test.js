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
  parseAnimationProtocol,
  safeParseAnimationProtocol,
} from "../src/animation-protocol.js";
import { createAnimationTools } from "../src/animation-tools.js";
import {
  CHARACTER_ANIMATION_ARTIFACT_TYPE,
  CHARACTER_ANIMATION_TOOL_ID,
  CHARACTER_ANIMATION_UPDATE_TOOL_ID,
} from "../src/contract.js";
import { activate, injectAnimationContext } from "../src/entries/agent.js";

const assets = ["robot-a", "robot-b"].map((name) => ({
  assetId: `user.glb.${name}`,
  name: `${name}.glb`,
  format: "glb",
  size: 12,
  animations: [{ name: "Walking", duration: 1.2, tracks: 42 }],
  nodes: ["Head"],
  bounds: { min: [0, 0, 0], max: [1, 1, 1], height: 1 },
  normalization: { targetHeight: 1, scale: 1, floorOffset: 0 },
  importedAt: "2026-08-29T00:00:00.000Z",
  resource: {
    version: "a".repeat(64),
    mimeType: "model/gltf-binary",
    size: 12,
    url: `/api/internal/character/assets/user.glb.${name}/${"a".repeat(64)}`,
  },
}));
const protocol = {
  format: "noobot.animation.protocol",
  version: 2,
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
    cameraTrack: {
      type: "keyframes",
      keyframes: [
        { time: 0, position: [0, 1, 5], target: [0, 0.5, 0], fov: 40 },
        { time: 2, position: [0, 1, 5], target: [0, 0.5, 0], fov: 40 },
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
    keyframes: [
      { time: 0, position: [-1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      { time: 1, position: [-0.2, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    ],
  };
  assert.equal(safeParseAnimationProtocol(moving).success, true);
  moving.characters[0].segments[0].rootMotion.keyframes[1].time = 0.9;
  assert.equal(safeParseAnimationProtocol(moving).success, false);
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
  assert.equal(hasSpatiallyReachableEvents(parseAnimationProtocol(fighting)), true);
});

test("declarative script compiles sequence, parallel and event into one protocol", () => {
  const declaration = protocol.characters[0];
  const compiled = compileAnimationScript({
    format: "noobot.animation.script",
    version: 1,
    loop: false,
    scene: protocol.scene,
    characters: [
      {
        characterId: declaration.characterId,
        assetId: declaration.assetId,
        rootTransform: declaration.rootTransform,
      },
    ],
    root: {
      type: "sequence",
      steps: [
        {
          type: "parallel",
          steps: [
            { type: "clip", characterId: declaration.characterId, clip: "Walking", duration: 1 },
            { type: "event", event: { eventId: "step-start", type: "marker", name: "start" } },
          ],
        },
        {
          type: "keyframes",
          characterId: declaration.characterId,
          duration: 1,
          tracks: protocol.characters[0].segments[1].tracks,
        },
      ],
    },
  });
  assert.equal(compiled.duration, 2);
  assert.equal(compiled.characters[0].segments[1].start, 1);
  assert.equal(compiled.events[0].time, 0);
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
});

test("the animation tool validates every selected character reference", async () => {
  const unselected = createTool([assets[0]]).tool;
  const missing = JSON.parse(await unselected.invoke({ protocol }));
  assert.deepEqual(
    { code: missing.code, assetId: missing.assetId },
    { code: "ANIMATION_ASSET_NOT_SELECTED", assetId: assets[1].assetId },
  );
  const unknownClip = structuredClone(protocol);
  unknownClip.characters[1].segments[0].clip = "Flying";
  const result = JSON.parse(await createTool().tool.invoke({ protocol: unknownClip }));
  assert.deepEqual(
    { code: result.code, assetId: result.assetId },
    { code: "ANIMATION_CLIP_NOT_IN_ASSET", assetId: assets[1].assetId },
  );
});

test("the tool preserves a supplied animation ID and returns authoritative identity", async () => {
  const { tool, commits } = createTool();
  const result = JSON.parse(await tool.invoke({ protocol }));
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
  const { animationId: _animationId, ...withoutId } = protocol;
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
        ...protocol,
        scene: protocol.scene,
        characters: [protocol.characters[0]],
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
