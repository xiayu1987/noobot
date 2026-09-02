/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { compileAnimationScript } from "../src/animation-protocol.js";
import { assets, generationProtocol, protocol } from "./fixtures/animation-fixtures.js";

test("declarative script compiles sequence, parallel and event into one protocol", () => {
  const declaration = protocol.characters[0];
  const compiled = compileAnimationScript({
    format: "noobot.animation.script",
    version: 1,
    loop: false,
    scene: generationProtocol.scene,
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

test("semantic motion nodes compile world targets and obstacle strategies", () => {
  const semantic = {
    format: "noobot.animation.script",
    version: 1,
    scene: {
      coordinateSystem: "normalized_world",
      unitHeight: 1,
      groundY: 0,
      collisionSpace: {
        units: "normalized_world",
        origin: [0, 0, 0],
        detection: "continuous",
        colliders: [
          {
            colliderId: "wall",
            characterId: "environment",
            node: null,
            role: "solid",
            shape: { type: "box", center: [1, 0.5, -1], size: [0.5, 1, 2] },
          },
        ],
      },
      camera: { presetId: "camera.static.wide" },
      contactConstraints: [],
    },
    characters: [
      {
        characterId: "character-1",
        assetId: assets[0].assetId,
        rootTransform: { position: [0, 0, -1], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        orientationMode: "auto",
      },
    ],
    root: {
      type: "sequence",
      steps: [
        {
          type: "move",
          characterId: "character-1",
          mode: "walk",
          clip: "Walking",
          target: [0, 0, -2],
        },
        {
          type: "move",
          characterId: "character-1",
          mode: "jump_over",
          clip: "Walking",
          target: [2, 0, -1],
          obstacleId: "wall",
        },
      ],
    },
  };
  const compiled = compileAnimationScript(semantic);
  assert.equal(compiled.characters[0].segments.length, 2);
  assert.equal(compiled.characters[0].segments[0].rootMotion.space, "character_local");
  assert.equal(compiled.characters[0].segments[1].rootMotion.keyframes.length, 3);
  assert.deepEqual(
    compiled.characters[0].segments[1].rootMotion.keyframes.at(-1).position,
    [2, 0, 1],
  );
});

test("orientation and posture nodes compile without changing position", () => {
  const semantic = {
    format: "noobot.animation.script",
    version: 1,
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
      camera: { presetId: "camera.static.wide" },
      contactConstraints: [],
    },
    characters: [
      {
        characterId: "character-1",
        assetId: assets[0].assetId,
        rootTransform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        orientationMode: "auto",
      },
    ],
    root: {
      type: "sequence",
      steps: [
        {
          type: "orient",
          characterId: "character-1",
          mode: "turn",
          clip: "Walking",
          angle: Math.PI / 2,
          duration: 0.5,
        },
        { type: "posture", characterId: "character-1", mode: "idle", clip: "Walking", duration: 1 },
      ],
    },
  };
  const compiled = compileAnimationScript(semantic);
  assert.equal(compiled.characters[0].segments.length, 2);
  assert.deepEqual(compiled.characters[0].segments[0].rootMotion.keyframes[0].position, [0, 0, 0]);
  assert.deepEqual(
    compiled.characters[0].segments[1].rootMotion.keyframes.at(-1).position,
    [0, 0, 0],
  );
  assert.equal(compiled.duration, 1.5);
});

test("model-authored channel nodes compile into the authoritative v4 keyframe timeline", () => {
  const declaration = protocol.characters[0];
  const compiled = compileAnimationScript({
    format: "noobot.animation.script",
    version: 1,
    loop: false,
    scene: generationProtocol.scene,
    characters: [
      {
        characterId: declaration.characterId,
        assetId: declaration.assetId,
        rootTransform: declaration.rootTransform,
      },
    ],
    root: {
      type: "channel",
      characterId: declaration.characterId,
      channelId: "arm.wave",
      duration: 1,
      tracks: [
        {
          node: "Head",
          property: "rotation",
          keyframes: [
            { time: 0, rotation: [0, 0, 0, 1] },
            { time: 1, rotation: [0, 0.3826834, 0, 0.9238795] },
          ],
        },
      ],
    },
  });
  const segment = compiled.characters[0].segments[0];
  assert.equal(compiled.duration, 1);
  assert.equal(segment.type, "keyframes");
  assert.equal(segment.tracks[0].channelId, "arm.wave");
  assert.equal(segment.tracks[0].node, "Head");
  assert.equal(segment.rootMotion, undefined);
});

test("channel nodes reject tracks belonging to another channel", () => {
  assert.throws(
    () =>
      compileAnimationScript({
        format: "noobot.animation.script",
        version: 1,
        loop: false,
        scene: generationProtocol.scene,
        characters: [
          {
            characterId: protocol.characters[0].characterId,
            assetId: protocol.characters[0].assetId,
            rootTransform: protocol.characters[0].rootTransform,
          },
        ],
        root: {
          type: "channel",
          characterId: protocol.characters[0].characterId,
          channelId: "arm.wave",
          duration: 1,
          tracks: [
            {
              channelId: "leg.step",
              node: "Head",
              property: "rotation",
              keyframes: [
                { time: 0, rotation: [0, 0, 0, 1] },
                { time: 1, rotation: [0, 0, 0, 1] },
              ],
            },
          ],
        },
      }),
    /channelId must match/,
  );
});

test("parallel channel nodes merge into one character timeline", () => {
  const declaration = protocol.characters[0];
  const compiled = compileAnimationScript({
    format: "noobot.animation.script",
    version: 1,
    loop: false,
    scene: generationProtocol.scene,
    characters: [
      {
        characterId: declaration.characterId,
        assetId: declaration.assetId,
        rootTransform: declaration.rootTransform,
      },
    ],
    root: {
      type: "parallel",
      steps: [
        {
          type: "channel",
          characterId: declaration.characterId,
          channelId: "body.position",
          duration: 1,
          tracks: [
            {
              node: "Head",
              property: "position",
              keyframes: [
                { time: 0, position: [0, 0, 0] },
                { time: 1, position: [0, 0.1, 0] },
              ],
            },
          ],
        },
        {
          type: "channel",
          characterId: declaration.characterId,
          channelId: "head.rotation",
          duration: 1,
          tracks: [
            {
              node: "Head",
              property: "rotation",
              keyframes: [
                { time: 0, rotation: [0, 0, 0, 1] },
                { time: 1, rotation: [0, 0.3826834, 0, 0.9238795] },
              ],
            },
          ],
        },
      ],
    },
  });
  assert.equal(compiled.characters[0].segments.length, 1);
  assert.equal(compiled.characters[0].segments[0].tracks.length, 2);
  assert.deepEqual(
    compiled.characters[0].segments[0].tracks.map((trackValue) => trackValue.channelId),
    ["body.position", "head.rotation"],
  );
});

test("parallel channels reject duplicate node properties", () => {
  const declaration = protocol.characters[0];
  const channel = (channelId) => ({
    type: "channel",
    characterId: declaration.characterId,
    channelId,
    duration: 1,
    tracks: [
      {
        node: "Head",
        property: "rotation",
        keyframes: [
          { time: 0, rotation: [0, 0, 0, 1] },
          { time: 1, rotation: [0, 0, 0, 1] },
        ],
      },
    ],
  });
  assert.throws(
    () =>
      compileAnimationScript({
        format: "noobot.animation.script",
        version: 1,
        loop: false,
        scene: generationProtocol.scene,
        characters: [
          {
            characterId: declaration.characterId,
            assetId: declaration.assetId,
            rootTransform: declaration.rootTransform,
          },
        ],
        root: { type: "parallel", steps: [channel("a"), channel("b")] },
      }),
    /same node\/property/,
  );
});
