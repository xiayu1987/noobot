/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  PLUGIN_ARTIFACT_EVENT,
  PLUGIN_ARTIFACT_SCHEMA_VERSION,
  PLUGIN_ARTIFACT_SEQUENCE_DOMAIN,
  createPluginArtifactEnvelope,
  EVENT_FAMILY,
  EVENT_REDUCER_INPUT,
  EVENT_REDUCER_TARGET,
  getEventFamily,
  getEventFamilyByWireEvent,
  validateProtocolEvent,
} from "../src/index.js";

const protocol = {
  format: "noobot.animation.protocol",
  version: 4,
  animationId: "wave-once",
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
      assetId: "sample.three.robot-expressive",
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
};
const assets = [
  {
    assetId: "sample.three.robot-expressive",
    name: "RobotExpressive.glb",
    format: "glb",
    size: 463988,
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
      size: 463988,
      url: `/api/internal/character/assets/sample.three.robot-expressive/${"a".repeat(64)}`,
    },
  },
];

test("plugin artifacts have one authoritative registry descriptor", () => {
  const descriptor = getEventFamily(EVENT_FAMILY.PLUGIN_ARTIFACT);
  assert.equal(getEventFamilyByWireEvent(PLUGIN_ARTIFACT_EVENT), descriptor);
  assert.equal(descriptor.reducerTarget, EVENT_REDUCER_TARGET.PLUGIN_ARTIFACT);
  assert.equal(descriptor.reducerInput, EVENT_REDUCER_INPUT.ENVELOPE);
  assert.equal(descriptor.persisted, true);
  assert.equal(descriptor.sessionArtifact, true);
});

test("plugin artifact ordering is scoped by plugin and artifact ID", () => {
  const envelope = createPluginArtifactEnvelope({
    pluginId: "character",
    artifactType: "character.animation",
    artifactId: protocol.animationId,
    sessionId: "session-1",
    turnScopeId: "turn-1",
    data: { protocol, assets },
    sequence: 2,
    occurredAt: "2026-08-29T00:00:00.000Z",
  });
  assert.deepEqual(validateProtocolEvent(envelope).errors, []);
  assert.equal(envelope.identity.eventType, PLUGIN_ARTIFACT_EVENT);
  assert.equal(envelope.protocol.schemaVersion, PLUGIN_ARTIFACT_SCHEMA_VERSION);
  assert.equal(envelope.ordering.domain, PLUGIN_ARTIFACT_SEQUENCE_DOMAIN);
  assert.equal(
    envelope.ordering.scopeId,
    `session-1:character:character.animation:${protocol.animationId}`,
  );
  assert.equal(envelope.payload.data.protocol, protocol);
});

test("plugin artifact authority rejects mismatched ordering", () => {
  assert.deepEqual(
    validateProtocolEvent({
      ...createPluginArtifactEnvelope({
        pluginId: "character",
        artifactType: "character.animation",
        artifactId: protocol.animationId,
        sessionId: "session-1",
        turnScopeId: "turn-1",
        data: { protocol, assets },
      }),
      ordering: {
        domain: PLUGIN_ARTIFACT_SEQUENCE_DOMAIN,
        scopeId: "session-1:another-animation",
        sequence: 1,
        revision: 1,
      },
    }).errors,
    ["sequence_scope_mismatch"],
  );
});
