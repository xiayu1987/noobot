/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SessionMessageService } from "../../src/session/services/session-message-service.js";
import { normalizeSessionEntity } from "../../src/session/entities/session-entity.js";
import { EVENT_FAMILY } from "@noobot/event-protocol";
import {
  PLUGIN_ARTIFACT_SCHEMA_VERSION,
  PLUGIN_ARTIFACT_SEQUENCE_DOMAIN,
  PLUGIN_ARTIFACT_EVENT,
} from "@noobot/event-protocol/plugin-artifact-event";

const protocol = {
  format: "noobot.animation.protocol",
  version: 4,
  animationId: "session-animation",
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
      assetId: "asset-1",
      rootTransform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      segments: [
        {
          type: "native_clip",
          start: 0,
          duration: 1,
          clip: "Idle",
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

test("plugin artifact commits persist an independent Session artifact fact", async () => {
  let session = {
    sessionId: "session-1",
    parentSessionId: "",
    aggregateVersion: 0,
    messages: [],
    authorityEventOutbox: [],
    sessionArtifactEvents: [],
  };
  const repo = {
    async resolveParentSessionId() {
      return "";
    },
    async findById() {
      return structuredClone(session);
    },
    async save(_userId, next) {
      session = structuredClone(next);
      session.aggregateVersion += 1;
      return session;
    },
  };
  const service = new SessionMessageService({
    sessionRepo: repo,
    now: () => "2026-08-29T00:00:00.000Z",
  });

  await service.commitAuthorityEvent({
    userId: "admin",
    sessionId: "session-1",
    family: EVENT_FAMILY.PLUGIN_ARTIFACT,
    schemaVersion: PLUGIN_ARTIFACT_SCHEMA_VERSION,
    identity: { eventType: PLUGIN_ARTIFACT_EVENT, turnScopeId: "turn-1" },
    ordering: {
      domain: PLUGIN_ARTIFACT_SEQUENCE_DOMAIN,
      scopeId: "session-1:character:character.animation:session-animation",
    },
    producer: { type: "plugin", id: "character" },
    payload: {
      pluginId: "character",
      artifactType: "character.animation",
      artifactId: "session-animation",
      operation: "created",
      revision: 1,
      baseRevision: null,
      data: {
        protocol,
        assets: [
          {
            assetId: "asset-1",
            name: "asset-1.glb",
            format: "glb",
            size: 12,
            animations: [{ name: "Idle", duration: 1, tracks: 1 }],
            nodes: ["Head"],
            sourceUnit: "meter",
            canonicalUnit: "normalized_world",
            anchor: "foot_center",
            axes: { handedness: "right", up: "Y", forward: "-Z" },
            bounds: { min: [0, 0, 0], max: [1, 1, 1], height: 1 },
            normalization: { targetHeight: 1, scale: 1, floorOffset: 0, anchorOffset: [0, 0, 0] },
            importedAt: "2026-08-29T00:00:00.000Z",
            resource: {
              version: "a".repeat(64),
              mimeType: "model/gltf-binary",
              size: 12,
              url: `/api/internal/character/assets/asset-1/${"a".repeat(64)}`,
            },
          },
        ],
      },
    },
  });

  assert.equal(session.authorityEventOutbox.length, 1);
  assert.equal(session.sessionArtifactEvents.length, 1);
  assert.equal(
    session.sessionArtifactEvents[0].payload.data.protocol.animationId,
    "session-animation",
  );
});

test("Session normalization never derives artifact history from the delivery outbox", () => {
  const envelope = {
    protocol: {
      name: "@noobot/event-protocol",
      version: 3,
      family: EVENT_FAMILY.PLUGIN_ARTIFACT,
      schemaVersion: PLUGIN_ARTIFACT_SCHEMA_VERSION,
    },
    identity: {
      eventId: "artifact-outbox-only",
      eventType: PLUGIN_ARTIFACT_EVENT,
      sessionId: "session-1",
      turnScopeId: "turn-1",
    },
    causality: {},
    ordering: {
      domain: PLUGIN_ARTIFACT_SEQUENCE_DOMAIN,
      scopeId: "session-1:character:character.animation:session-animation",
      sequence: 1,
    },
    producer: { type: "plugin", id: "character" },
    occurredAt: "2026-08-29T00:00:00.000Z",
    payload: {
      pluginId: "character",
      artifactType: "character.animation",
      artifactId: "session-animation",
      operation: "created",
      revision: 1,
      baseRevision: null,
      data: { protocol, assets: [] },
    },
  };
  const normalized = normalizeSessionEntity({
    sessionId: "session-1",
    parentSessionId: "",
    aggregateVersion: 1,
    messages: [],
    authorityEventOutbox: [
      {
        eventId: envelope.identity.eventId,
        envelope,
        committedAt: envelope.occurredAt,
        delivery: { status: "pending", attempts: 0 },
      },
    ],
  });

  assert.deepEqual(normalized.sessionArtifactEvents, []);
});

test("plugin artifact replacement increments revision and rejects a stale base revision", async () => {
  let session = {
    sessionId: "session-1",
    parentSessionId: "",
    aggregateVersion: 0,
    messages: [],
    authorityEventOutbox: [],
    sessionArtifactEvents: [],
  };
  const repo = {
    async resolveParentSessionId() {
      return "";
    },
    async findById() {
      return structuredClone(session);
    },
    async save(_userId, next) {
      session = structuredClone(next);
      session.aggregateVersion += 1;
      return session;
    },
  };
  const service = new SessionMessageService({
    sessionRepo: repo,
    now: () => "2026-08-29T00:00:00.000Z",
  });
  const common = {
    userId: "admin",
    sessionId: "session-1",
    family: EVENT_FAMILY.PLUGIN_ARTIFACT,
    schemaVersion: PLUGIN_ARTIFACT_SCHEMA_VERSION,
    identity: { eventType: PLUGIN_ARTIFACT_EVENT, turnScopeId: "turn-1" },
    ordering: {
      domain: PLUGIN_ARTIFACT_SEQUENCE_DOMAIN,
      scopeId: "session-1:character:character.animation:session-animation",
    },
    producer: { type: "plugin", id: "character" },
  };
  await service.commitAuthorityEvent({
    ...common,
    payload: {
      pluginId: "character",
      artifactType: "character.animation",
      artifactId: "session-animation",
      operation: "created",
      revision: 1,
      baseRevision: null,
      data: { protocol, assets: [] },
    },
  });
  const replaced = await service.commitAuthorityEvent({
    ...common,
    payload: {
      pluginId: "character",
      artifactType: "character.animation",
      artifactId: "session-animation",
      operation: "replaced",
      revision: 2,
      baseRevision: 1,
      data: { protocol, assets: [] },
    },
  });
  assert.equal(replaced.committed, true);
  assert.equal(replaced.envelope.payload.revision, 2);
  const stale = await service.commitAuthorityEvent({
    ...common,
    payload: {
      pluginId: "character",
      artifactType: "character.animation",
      artifactId: "session-animation",
      operation: "replaced",
      revision: 2,
      baseRevision: 1,
      data: { protocol, assets: [] },
    },
  });
  assert.equal(stale.committed, false);
  assert.equal(stale.code, "ARTIFACT_REVISION_CONFLICT");
});
