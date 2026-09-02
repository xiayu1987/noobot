/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createPluginArtifactEnvelope } from "@noobot/event-protocol/plugin-artifact-event";
import {
  animationRuntimeState,
  applyAnimationRuntimeEvent,
  resetAnimationRuntimeState,
} from "../frontend/runtime/animationState.js";
import { CHARACTER_ANIMATION_ARTIFACT_TYPE, CHARACTER_PLUGIN_ID } from "../src/contract.js";

const protocol = (animationId, assetId = "robot-a") => ({
  format: "noobot.animation.protocol",
  version: 4,
  animationId,
  duration: 1,
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
      positionInterpolation: "linear",
      targetInterpolation: "linear",
      fovInterpolation: "linear",
      keyframes: [
        {
          time: 0,
          position: [0, 1, 5],
          target: [0, 0.5, 0],
          fov: 40,
          transition: "blend",
          easing: "linear",
        },
        {
          time: 1,
          position: [0, 1, 5],
          target: [0, 0.5, 0],
          fov: 40,
          transition: "blend",
          easing: "linear",
        },
      ],
    },
  },
  characters: [
    {
      characterId: "character-1",
      assetId,
      rootTransform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      segments: [
        {
          type: "native_clip",
          start: 0,
          duration: 1,
          clip: "Wave",
          rootMotion: {
            space: "normalized_world",
            keyframes: [
              { time: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
              { time: 1, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
            ],
          },
        },
      ],
    },
  ],
  events: [],
});
const asset = (assetId = "robot-a") => ({
  assetId,
  name: `${assetId}.glb`,
  format: "glb",
  size: 12,
  animations: [{ name: "Wave", duration: 1, tracks: 1 }],
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
    url: `/api/internal/character/assets/${assetId}/${"a".repeat(64)}`,
  },
});

test("same animation ID replaces one card and different IDs create cards", () => {
  resetAnimationRuntimeState("session-a");
  let event = 0;
  const revisions = new Map();
  const envelope = (animationId, assetId) => {
    const baseRevision = revisions.get(animationId) || 0;
    const revision = baseRevision + 1;
    revisions.set(animationId, revision);
    event += 1;
    return createPluginArtifactEnvelope({
      pluginId: CHARACTER_PLUGIN_ID,
      artifactType: CHARACTER_ANIMATION_ARTIFACT_TYPE,
      artifactId: animationId,
      sessionId: "session-a",
      turnScopeId: "turn-1",
      sequence: event,
      operation: baseRevision ? "replaced" : "created",
      revision,
      baseRevision: baseRevision || null,
      data: { protocol: protocol(animationId, assetId), assets: [asset(assetId)] },
    });
  };
  assert.equal(applyAnimationRuntimeEvent(envelope("animation-a")).created, true);
  assert.equal(applyAnimationRuntimeEvent(envelope("animation-a")).created, false);
  applyAnimationRuntimeEvent(envelope("animation-b", "robot-b"));
  assert.equal(animationRuntimeState.cards.length, 2);
  assert.equal(animationRuntimeState.cards[0].protocol.animationId, "animation-a");
  assert.equal(animationRuntimeState.cards[0].revision, 2);
  resetAnimationRuntimeState();
});

test("the character projector rejects another plugin's artifact", () => {
  resetAnimationRuntimeState("session-a");
  const result = applyAnimationRuntimeEvent({
    identity: { sessionId: "session-a", eventId: "event-other" },
    payload: {
      pluginId: "other",
      artifactType: CHARACTER_ANIMATION_ARTIFACT_TYPE,
      data: { protocol: protocol("animation-a"), assets: [asset()] },
    },
  });
  assert.deepEqual(result, { applied: false, reason: "unsupported_character_artifact" });
  assert.equal(animationRuntimeState.cards.length, 0);
});

test("a live event applies after establishing its session boundary", () => {
  resetAnimationRuntimeState("previous-session");
  const envelope = createPluginArtifactEnvelope({
    pluginId: CHARACTER_PLUGIN_ID,
    artifactType: CHARACTER_ANIMATION_ARTIFACT_TYPE,
    artifactId: "animation-live",
    sessionId: "live-session",
    turnScopeId: "turn-live",
    sequence: 1,
    operation: "created",
    revision: 1,
    data: { protocol: protocol("animation-live"), assets: [asset()] },
  });
  resetAnimationRuntimeState(envelope.identity.sessionId);
  const result = applyAnimationRuntimeEvent(envelope);
  assert.equal(result.applied, true);
  assert.equal(animationRuntimeState.sessionId, "live-session");
  assert.equal(animationRuntimeState.cards.length, 1);
  resetAnimationRuntimeState();
});
