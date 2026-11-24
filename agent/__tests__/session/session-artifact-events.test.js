/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { SessionMessageService } from "../../src/session/services/session-message-service.js";
import { normalizeSessionEntity } from "../../src/session/entities/session-entity.js";
import { EVENT_FAMILY } from "@noobot/event-protocol";
import {
  PLUGIN_ARTIFACT_SCHEMA_VERSION,
  PLUGIN_ARTIFACT_SEQUENCE_DOMAIN,
  PLUGIN_ARTIFACT_EVENT,
} from "@noobot/event-protocol/plugin-artifact-event";
import {
  WORKFLOW_RUNTIME_EVENT,
  WORKFLOW_SEQUENCE_DOMAIN,
} from "@noobot/event-protocol/workflow-runtime-event";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";
import {
  createTestSessionServices,
  provisionTestSession,
  commitTestSessionChanges,
} from "../helpers/session-services.js";
import { processingTurnChanges } from "../helpers/turn-command-fixture.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";

async function fixture(t) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-artifact-outbox-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await initializeUserWorkspace(workspaceRoot, "admin");
  const runtime = createTestSessionServices({ workspaceRoot });
  await provisionTestSession(runtime, {
    userId: "admin",
    sessionId: "session-1",
    parentSessionId: "",
    caller: "user",
  });
  for (const changes of processingTurnChanges({
    sessionId: "session-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    presentationMessageId: "presentation-1",
  })) {
    const committed = await commitTestSessionChanges(runtime, {
      userId: "admin",
      sessionId: "session-1",
      changes,
    });
    assert.equal(committed.result.turnTransition.applied, true);
  }
  const repo = runtime.repositories.sessionRepository;
  const persistenceContext = repo.treePersistenceContext("admin", "session-1");
  const before = await repo.requireById("admin", "session-1", { persistenceContext });
  const beforeReader = await repo.requireSessionReader("admin", "session-1", {
    persistenceContext,
  });
  const initialEvents = (await beforeReader.readOutboxPage({ consumerId: "test-consumer" })).events;
  return {
    initialVersion: before.aggregateVersion,
    initialEvents,
    service: runtime.sessionMessageService,
    persistenceContext,
    read: () => repo.requireSessionReader("admin", "session-1", { persistenceContext }),
  };
}

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

async function assertOutboxCommits(reader, initialEvents, commits) {
  const { events } = await reader.readOutboxPage({ consumerId: "test-consumer" });
  assert.deepEqual(events.slice(0, initialEvents.length), initialEvents);
  assert.deepEqual(
    events.slice(initialEvents.length).map(({ eventId }) => eventId),
    commits.map(({ envelope }) => envelope.identity.eventId),
  );
}

test("workflow node facts persist in the parent turn without creating a child turn there", async (t) => {
  const { service, read, persistenceContext, initialEvents } = await fixture(t);
  const request = {
    persistenceContext,
    userId: "admin",
    sessionId: "session-1",
    family: EVENT_FAMILY.WORKFLOW_RUNTIME,
    identity: {
      eventType: WORKFLOW_RUNTIME_EVENT.NODE_STATE,
      turnScopeId: "turn-1",
      executionId: "node-1",
    },
    causality: { commandId: "workflow-node:node-1", correlationId: "run-1" },
    ordering: { domain: WORKFLOW_SEQUENCE_DOMAIN.NODE_STATE, scopeId: "run-1", revision: 1 },
    producer: { type: "plugin", id: "workflow" },
    payload: {
      workflowRunId: "run-1",
      nodeSessionId: "child-session",
      turnScopeId: "workflow-node:node-1",
      status: "running",
      activeChildExecutionId: "agent:node-1",
      attemptExecutionIds: ["agent:node-1"],
    },
  };
  await assert.rejects(
    service.commitAuthorityEvent({
      ...request,
      identity: { ...request.identity, turnScopeId: request.payload.turnScopeId },
    }),
    /Authority event requires a visible turn/,
  );
  const committed = await service.commitAuthorityEvent(request);
  assert.equal(committed.committed, true);
  assert.equal(committed.envelope.identity.turnScopeId, "turn-1");
  assert.equal(committed.envelope.payload.turnScopeId, "workflow-node:node-1");
  await assertOutboxCommits(await read(), initialEvents, [committed]);
});

test("plugin artifact commits persist an independent Session artifact fact", async (t) => {
  const { service, read, persistenceContext, initialVersion, initialEvents } = await fixture(t);

  const committed = await service.commitAuthorityEvent({
    persistenceContext,
    userId: "admin",
    sessionId: "session-1",
    family: EVENT_FAMILY.PLUGIN_ARTIFACT,
    schemaVersion: PLUGIN_ARTIFACT_SCHEMA_VERSION,
    identity: { eventType: PLUGIN_ARTIFACT_EVENT, turnScopeId: "turn-1" },
    causality: {},
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

  const reader = await read();
  const session = await reader.exportSession();
  await assertOutboxCommits(reader, initialEvents, [committed]);
  assert.equal(session.sessionArtifactEvents.length, 1);
  assert.equal(session.aggregateVersion, initialVersion + 1);
  assert.equal(committed.aggregateVersion, initialVersion + 1);
  assert.equal(committed.envelope.ordering.aggregateVersion, initialVersion + 1);
  assert.equal(
    session.sessionArtifactEvents[0].payload.data.protocol.animationId,
    "session-animation",
  );
  const artifact = await service.getPluginArtifact({
    persistenceContext,
    userId: "admin",
    sessionId: "session-1",
    pluginId: "character",
    artifactType: "character.animation",
    artifactId: "session-animation",
  });
  assert.equal(artifact.found, true);
  assert.equal(artifact.revision, 1);
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
    ...createTestSessionRequiredFields(),
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

test("plugin artifact replacement increments revision and rejects a stale base revision", async (t) => {
  const { service, read, persistenceContext } = await fixture(t);
  const common = {
    persistenceContext,
    userId: "admin",
    sessionId: "session-1",
    family: EVENT_FAMILY.PLUGIN_ARTIFACT,
    schemaVersion: PLUGIN_ARTIFACT_SCHEMA_VERSION,
    causality: {},
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
  const before = (await read()).generation;
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
  assert.equal((await read()).generation, before);
});

test("authority event commit rejects non-canonical owner, ordering and unknown family before mutation", async () => {
  let mutations = 0;
  const service = new SessionMessageService({
    sessionRepo: {
      async withSessionMutation() {
        mutations += 1;
        throw new Error("mutation must not start");
      },
    },
    now: () => "2026-08-29T00:00:00.000Z",
  });
  const base = {
    userId: "admin",
    sessionId: "session-1",
    family: EVENT_FAMILY.PLUGIN_ARTIFACT,
    identity: {},
    causality: {},
    ordering: { domain: "plugin-artifact", scopeId: "artifact-1" },
    producer: { type: "plugin", id: "workflow" },
    payload: {},
  };
  const cases = [
    [{ userId: " admin" }, /canonical user and session/],
    [{ sessionId: "session-1 " }, /canonical user and session/],
    [{ sessionId: "" }, /canonical user and session/],
    [{ family: "unknown.family" }, /family not registered: unknown\.family/],
    [{ ordering: undefined }, /canonical ordering domain and scope/],
    [{ ordering: { domain: " plugin-artifact", scopeId: "artifact-1" } }, /canonical ordering/],
    [{ ordering: { domain: "plugin-artifact", scopeId: "" } }, /canonical ordering/],
  ];
  for (const [override, message] of cases) {
    await assert.rejects(service.commitAuthorityEvent({ ...base, ...override }), message);
  }
  assert.equal(mutations, 0);
});

test("concurrent authority event commits serialize revision and sequence allocation", async (t) => {
  const { service, read, persistenceContext, initialVersion, initialEvents } = await fixture(t);
  const commit = (baseRevision = null) =>
    service.commitAuthorityEvent({
      persistenceContext,
      userId: "admin",
      sessionId: "session-1",
      family: EVENT_FAMILY.PLUGIN_ARTIFACT,
      schemaVersion: PLUGIN_ARTIFACT_SCHEMA_VERSION,
      causality: {},
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
        operation: baseRevision === null ? "created" : "replaced",
        revision: baseRevision === null ? 1 : baseRevision + 1,
        baseRevision,
        data: { protocol, assets: [] },
      },
    });

  const created = await Promise.all([commit(), commit(), commit()]);
  const replaced = await Promise.all([commit(1), commit(1), commit(1)]);
  for (const results of [created, replaced]) {
    assert.equal(results.filter((result) => result.committed).length, 1);
    assert.equal(results.filter((result) => !result.committed).length, 2);
  }
  const commits = [...created, ...replaced].filter((result) => result.committed);
  const sequences = commits.map((result) => result.envelope.ordering.sequence);
  assert.deepEqual(sequences, [1, 2]);
  const reader = await read();
  await assertOutboxCommits(reader, initialEvents, commits);
  assert.equal((await reader.exportSession()).aggregateVersion, initialVersion + 2);
  assert.deepEqual(
    commits.map((result) => result.aggregateVersion),
    [initialVersion + 1, initialVersion + 2],
  );
});
