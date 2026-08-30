/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  animationRuntimeState,
  applyAnimationRuntimeEvent,
  resetAnimationRuntimeState,
} from "../frontend/runtime/animationState.js";
import { CHARACTER_ANIMATION_ARTIFACT_TYPE, CHARACTER_PLUGIN_ID } from "../src/contract.js";

const protocol = (animationId, assetId = "robot-a") => ({
  format: "noobot.animation.protocol",
  version: 1,
  animationId,
  duration: 1,
  loop: false,
  characters: [
    {
      assetId,
      initialPosition: [0, 0, 0],
      segments: [{ type: "native_clip", start: 0, duration: 1, clip: "Wave" }],
    },
  ],
});
const asset = (assetId = "robot-a") => ({
  assetId,
  name: `${assetId}.glb`,
  format: "glb",
  size: 12,
  animations: [{ name: "Wave", duration: 1, tracks: 1 }],
  nodes: ["Head"],
  importedAt: "2026-08-29T00:00:00.000Z",
  resource: {
    version: "a".repeat(64),
    mimeType: "model/gltf-binary",
    size: 12,
    url: `/api/internal/character/assets/${assetId}/${"a".repeat(64)}`,
  },
});

test("same animation ID appends to one card and different IDs create cards", () => {
  resetAnimationRuntimeState("session-a");
  let event = 0;
  const envelope = (animationId, assetId) => ({
    identity: { sessionId: "session-a", eventId: `event-${++event}` },
    payload: {
      pluginId: CHARACTER_PLUGIN_ID,
      artifactType: CHARACTER_ANIMATION_ARTIFACT_TYPE,
      data: { protocol: protocol(animationId, assetId), assets: [asset(assetId)] },
    },
  });
  assert.equal(applyAnimationRuntimeEvent(envelope("animation-a")).created, true);
  assert.equal(applyAnimationRuntimeEvent(envelope("animation-a")).created, false);
  applyAnimationRuntimeEvent(envelope("animation-b", "robot-b"));
  assert.equal(animationRuntimeState.cards.length, 2);
  assert.equal(animationRuntimeState.cards[0].protocols.length, 2);
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
