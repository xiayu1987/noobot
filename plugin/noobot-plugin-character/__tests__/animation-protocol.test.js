/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelContext } from "@noobot/context-protocol";
import { parseAnimationProtocol, safeParseAnimationProtocol } from "../src/animation-protocol.js";
import { createAnimationTools } from "../src/animation-tools.js";
import { CHARACTER_ANIMATION_ARTIFACT_TYPE } from "../src/contract.js";
import { activate, injectAnimationContext } from "../src/entries/agent.js";

const assets = ["robot-a", "robot-b"].map((name) => ({
  assetId: `user.glb.${name}`,
  name: `${name}.glb`,
  format: "glb",
  size: 12,
  animations: [{ name: "Walking", duration: 1.2, tracks: 42 }],
  nodes: ["Head"],
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
  version: 1,
  animationId: "walk-and-nod",
  duration: 2,
  loop: false,
  characters: assets.map((asset, index) => ({
    assetId: asset.assetId,
    initialPosition: [index * 2, 0, 0],
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
};

function createTool(selectedAssets = assets) {
  const commits = [];
  const tool = createAnimationTools({
    pluginConfig: {
      characterAssets: selectedAssets,
      selectedCharacterAssetIds: selectedAssets.map((asset) => asset.assetId),
    },
    commitArtifact: async (artifact) => {
      commits.push(artifact);
      return {
        identity: { eventId: `event-${commits.length}` },
      };
    },
  })[0];
  return { tool, commits };
}

test("animation protocol accepts synchronized character timelines and explicit positions", () => {
  assert.equal(parseAnimationProtocol(protocol).characters.length, 2);
  const invalid = structuredClone(protocol);
  invalid.characters[1].segments[1].start = 1.5;
  assert.equal(safeParseAnimationProtocol(invalid).success, false);
  const duplicate = structuredClone(protocol);
  duplicate.characters[1].assetId = duplicate.characters[0].assetId;
  assert.equal(safeParseAnimationProtocol(duplicate).success, false);
});

test("character context is absent without a selection and injected once with exact metadata", () => {
  const modelContext = createModelContext({
    messageBlocks: { system: [], history: [], incremental: [] },
  });
  const context = { modelContext };
  assert.equal(injectAnimationContext(context, {}), false);
  const config = {
    characterAssets: assets,
    selectedCharacterAssetIds: assets.map((asset) => asset.assetId),
  };
  assert.equal(injectAnimationContext(context, config), true);
  assert.equal(injectAnimationContext(context, config), false);
  assert.match(String(modelContext.messageBlocks.system[0].content), /initialPosition/);
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

test("the registered tool commits through the declared artifact port", async () => {
  let registeredFactory = null;
  const commits = [];
  const agentContext = { protocolVersion: 1 };
  const activation = activate(
    {
      hooks: { register: () => () => undefined },
      artifacts: {
        commit: async (artifact, toolContext) => {
          commits.push({ artifact, toolContext });
          return { identity: { eventId: "event-1" } };
        },
      },
      tools: {
        register: (_id, factory) => {
          registeredFactory = factory;
          return { dispose() {} };
        },
      },
    },
    {
      characterAssets: assets,
      selectedCharacterAssetIds: assets.map((asset) => asset.assetId),
    },
  );
  const tool = registeredFactory({ agentContext });
  const result = JSON.parse(
    await tool.invoke({
      protocol: {
        ...protocol,
        characters: [protocol.characters[0]],
      },
    }),
  );
  activation.dispose();
  assert.equal(result.ok, true);
  assert.equal(commits[0].artifact.artifactType, CHARACTER_ANIMATION_ARTIFACT_TYPE);
  assert.equal(commits[0].toolContext.agentContext, agentContext);
});
