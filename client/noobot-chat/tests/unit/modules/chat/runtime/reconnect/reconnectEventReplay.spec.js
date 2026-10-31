/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyReconnectEventReplay } from "../../../../../../src/modules/chat/runtime/reconnect/reconnectEventReplay.js";
import { StreamEventEnum } from "../../../../../../src/modules/chat/model/chatConstants.js";
import {
  clearExtensionRegistry,
  contributeExtension,
} from "../../../../../../src/extensions/extension-registry.js";
import { EXTENSION_POINTS } from "@noobot/plugin-protocol/frontend";
import { activate as activateWorkflowFrontend } from "../../../../../../../../plugin/noobot-plugin-workflow/frontend/index.js";
import { createTurnKey } from "../../../../../../src/modules/chat/runtime/engine/turnIdentity.js";
import { canonicalWorkflowRuntimeEvent } from "../../helpers/workflowRuntimeEventFixture.js";
import { WORKFLOW_RUNTIME_EVENT } from "@noobot/event-protocol/workflow-runtime-event";
import { createTurnLifecycleEventEnvelope } from "@noobot/event-protocol";
import {
  createTurnLifecycleEnvelope,
  TURN_EVENT,
  TURN_PHASE,
  TURN_STATE,
} from "@noobot/session-protocol";
import { canonicalMessageEvent } from "../../helpers/messageEventFixture.js";
import { createPluginArtifactEnvelope } from "@noobot/event-protocol/plugin-artifact-event";

describe("applyReconnectEventReplay", () => {
  beforeEach(() => {
    void activateWorkflowFrontend({
      contributeExtension: (point, contribution) =>
        contributeExtension(point, { ...contribution, pluginId: "workflow" }),
      extensionPoints: EXTENSION_POINTS,
      services: {},
    });
  });
  afterEach(() => clearExtensionRegistry());

  it.each(["workflow_planning_message_prepared", "workflow_node_state_committed"])(
    "routes %s directly to workflow runtime projection after reconnect",
    async (event) => {
      const data = {
        authoritySessionId: "s-1",
        turnScopeId: "turn-1",
        workflowRunId: "workflow-1",
        ...(event === WORKFLOW_RUNTIME_EVENT.PLANNING
          ? {
              eventId: "workflow-planning-1",
              executionId: "workflow-1",
              sessionId: "s-1",
              dialogProcessId: "dp-1",
              presentationMessageId: "workflow-message-1",
              workflowPayload: {
                nodes: [{ nodeExecutionId: "node-1" }],
                nodeSessions: [
                  {
                    nodeExecutionId: "node-1",
                    eventId: "workflow_node_state:workflow-1:node-1:1",
                    status: "pending",
                    revision: 1,
                    sequence: 1,
                  },
                ],
              },
            }
          : {
              eventId: "workflow-node-state-1",
              executionId: "node-1",
              nodeSessionId: "node-session-1",
              status: "running",
            }),
      };
      const applyWorkflowRuntimeEvent = vi.fn(() => ({ applied: true }));
      const applyReconnectMessagesToActiveSession = vi.fn();

      const envelope = canonicalWorkflowRuntimeEvent(event, data);
      const result = await applyReconnectEventReplay({
        event: envelope.identity.eventType,
        data: envelope,
        replayCache: {},
        isDeletedTurn: vi.fn(() => false),
        isCurrentActiveSession: vi.fn(() => true),
        consumeReplayCacheForSession: vi.fn(),
        applyReconnectMessagesToActiveSession,
        applyWorkflowRuntimeEvent,
      });

      expect(result).toEqual({ applied: true });
      expect(applyWorkflowRuntimeEvent).toHaveBeenCalledWith(envelope, { source: "reconnect" });
      expect(applyReconnectMessagesToActiveSession).not.toHaveBeenCalled();
    },
  );

  it("routes authoritative TURN_LIFECYCLE envelopes directly to the lifecycle reducer", async () => {
    const replayCache = {};
    const applyTurnLifecycleEnvelope = vi.fn(() => ({ applied: true }));
    const lifecycle = createTurnLifecycleEnvelope({
      eventType: TURN_EVENT.PROCESSING_STARTED,
      eventId: "event-1",
      commandId: "command-1",
      sessionId: "s-1",
      parentSessionId: "",
      turnScopeId: "turn-1",
      presentationMessageId: "presentation-1",
      dialogProcessId: "dp-1",
      revision: 2,
      sequence: 2,
      phase: TURN_PHASE.PROCESSING,
      state: TURN_STATE.PROCESSING,
    });
    const envelope = createTurnLifecycleEventEnvelope(lifecycle, {
      producer: { type: "test", id: "turn-lifecycle-fixture" },
    });

    const result = await applyReconnectEventReplay({
      event: StreamEventEnum.TURN_LIFECYCLE,
      data: envelope,
      replayCache,
      isDeletedTurn: vi.fn(() => false),
      isCurrentActiveSession: vi.fn(() => false),
      consumeReplayCacheForSession: vi.fn(),
      applyReconnectMessagesToActiveSession: vi.fn(),
      applyTurnLifecycleEnvelope,
    });

    expect(result).toEqual({ applied: true });
    expect(applyTurnLifecycleEnvelope).toHaveBeenCalledOnce();
    expect(applyTurnLifecycleEnvelope).toHaveBeenCalledWith(lifecycle);
    expect(replayCache).toEqual({});
  });

  it("routes plugin artifact envelopes to the runtime projector after reconnect", async () => {
    const envelope = createPluginArtifactEnvelope({
      sequence: 1,
      revision: 1,
      occurredAt: "2026-10-22T00:00:00.000Z",
      operation: "created",
      baseRevision: null,
      pluginId: "character",
      artifactType: "character.animation",
      artifactId: "animation-1",
      sessionId: "s-1",
      turnScopeId: "turn-1",
      data: {
        protocol: {
          format: "noobot.animation.protocol",
          version: 4,
          animationId: "animation-1",
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
        },
        assets: [
          {
            assetId: "asset-1",
            name: "asset-1.glb",
            format: "glb",
            size: 12,
            animations: [{ name: "Idle", duration: 1, tracks: 1 }],
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
              url: `/api/internal/character/assets/asset-1/${"a".repeat(64)}`,
            },
          },
        ],
      },
    });
    const applyRuntimeStreamEvent = vi.fn(() => ({ applied: true }));
    const result = await applyReconnectEventReplay({
      event: envelope.identity.eventType,
      data: envelope,
      replayCache: {},
      isDeletedTurn: vi.fn(() => false),
      isCurrentActiveSession: vi.fn(() => true),
      consumeReplayCacheForSession: vi.fn(),
      applyReconnectMessagesToActiveSession: vi.fn(),
      applyRuntimeStreamEvent,
    });

    expect(result).toEqual({ applied: true });
    expect(applyRuntimeStreamEvent).toHaveBeenCalledWith(envelope, { source: "reconnect" });
  });

  it("ignores CHANNEL_STATE because it is transport projection only", async () => {
    const replayCache = {};
    const consumeReplayCacheForSession = vi.fn();
    const applyReconnectMessagesToActiveSession = vi.fn();

    const result = await applyReconnectEventReplay({
      event: StreamEventEnum.CHANNEL_STATE,
      data: { state: "connected" },
      replayCache,
      isDeletedTurn: vi.fn(() => false),
      isCurrentActiveSession: vi.fn(() => true),
      consumeReplayCacheForSession,
      applyReconnectMessagesToActiveSession,
    });

    expect(result).toEqual({ applied: false, reason: "transport_channel_state_ignored" });
    expect(consumeReplayCacheForSession).not.toHaveBeenCalled();
    expect(applyReconnectMessagesToActiveSession).not.toHaveBeenCalled();
    expect(replayCache).toEqual({});
  });

  it("applies active session events after consuming cached replay", async () => {
    const replayCache = {};
    const consumeReplayCacheForSession = vi.fn(async () => {});
    const applyReconnectMessagesToActiveSession = vi.fn(async () => {});

    const envelope = canonicalMessageEvent({
      eventType: "llm_delta",
      sessionId: "s-1",
      presentationMessageId: "message-1",
      turnScopeId: "turn-1",
      dialogProcessId: "dp-1",
      text: "hello",
    });
    await applyReconnectEventReplay({
      event: envelope.identity.eventType,
      data: envelope,
      replayCache,
      isDeletedTurn: vi.fn(() => false),
      isCurrentActiveSession: vi.fn((sessionId) => sessionId === "s-1"),
      consumeReplayCacheForSession,
      applyReconnectMessagesToActiveSession,
    });

    expect(consumeReplayCacheForSession).toHaveBeenCalledWith("s-1");
    expect(applyReconnectMessagesToActiveSession).toHaveBeenCalledWith([envelope], {
      turnScopeId: "turn-1",
    });
    expect(replayCache).toEqual({});
  });

  it("routes workflow-node message envelopes to the sub-session replay before root replay", async () => {
    const replayCache = {};
    const consumeReplayCacheForSession = vi.fn(async () => {});
    const applyReconnectMessagesToActiveSession = vi.fn(async () => {});
    const applySubSessionReplayMessages = vi.fn(async () => ({ applied: true, appliedCount: 1 }));
    const envelope = canonicalMessageEvent({
      eventId: "workflow-child-1",
      eventType: "thinking",
      activityId: "activity-l309",
      activityKind: "model_analysis",
      sessionId: "child-session-1",
      turnScopeId: "workflow-node:node-1",
      presentationMessageId: "child-message-1",
      dialogProcessId: "dp-child-1",
      workflowRunId: "workflow-run-1",
      nodeExecutionId: "node-1",
      parentSessionId: "s-1",
      text: "working",
    });

    const result = await applyReconnectEventReplay({
      event: envelope.identity.eventType,
      data: envelope,
      replayCache,
      isDeletedTurn: vi.fn(() => false),
      isCurrentActiveSession: vi.fn(() => true),
      consumeReplayCacheForSession,
      applyReconnectMessagesToActiveSession,
      applySubSessionReplayMessages,
    });

    expect(result).toEqual({ applied: true, appliedCount: 1 });
    expect(applySubSessionReplayMessages).toHaveBeenCalledWith([envelope], {
      rootSessionId: "s-1",
      dialogProcessId: "dp-child-1",
      turnScopeId: "workflow-node:node-1",
    });
    expect(consumeReplayCacheForSession).not.toHaveBeenCalled();
    expect(applyReconnectMessagesToActiveSession).not.toHaveBeenCalled();
    expect(replayCache).toEqual({});
  });

  it("caches non-active session events by normalized replay key", async () => {
    const replayCache = {};

    const envelope = canonicalMessageEvent({
      eventType: "llm_delta",
      sessionId: "s-2",
      presentationMessageId: "message-2",
      turnScopeId: "turn-2",
      dialogProcessId: "dp-2",
      text: "cached",
    });
    await applyReconnectEventReplay({
      event: envelope.identity.eventType,
      data: envelope,
      replayCache,
      isDeletedTurn: vi.fn(() => false),
      isCurrentActiveSession: vi.fn(() => false),
      consumeReplayCacheForSession: vi.fn(),
      applyReconnectMessagesToActiveSession: vi.fn(),
    });

    expect(replayCache).toEqual({
      "s-2": {
        [createTurnKey({ sessionId: "s-2", turnScopeId: "turn-2" })]: [envelope],
      },
    });
  });

  it("rejects dialog-only replay events without Session and Turn identity", async () => {
    const replayCache = {};
    const consumeReplayCacheForSession = vi.fn(async () => {});
    const applyReconnectMessagesToActiveSession = vi.fn(async () => {});

    const result = await applyReconnectEventReplay({
      event: "message",
      data: { dialogProcessId: "dp-1", text: "tool running" },
      replayCache,
      isDeletedTurn: vi.fn(() => false),
      isCurrentActiveSession: vi.fn(() => false),
      consumeReplayCacheForSession,
      applyReconnectMessagesToActiveSession,
    });

    expect(result).toEqual({
      applied: false,
      reason: "unsupported_replay_event",
      errors: ["unregistered_non_envelope_event"],
    });
    expect(consumeReplayCacheForSession).not.toHaveBeenCalled();
    expect(applyReconnectMessagesToActiveSession).not.toHaveBeenCalled();
    expect(replayCache).toEqual({});
  });

  it.each(["done", "user_stopped", "error"])(
    "rejects retired non-envelope terminal event %s explicitly",
    async (event) => {
      const applyTurnLifecycleEnvelope = vi.fn();
      const result = await applyReconnectEventReplay({
        event,
        data: { sessionId: "s-1", turnScopeId: "turn-1", seq: 2 },
        replayCache: {},
        isDeletedTurn: vi.fn(() => false),
        isCurrentActiveSession: vi.fn(() => true),
        consumeReplayCacheForSession: vi.fn(),
        applyReconnectMessagesToActiveSession: vi.fn(),
        applyTurnLifecycleEnvelope,
      });

      expect(result).toEqual({
        applied: false,
        reason: "unsupported_replay_event",
        errors: ["unregistered_non_envelope_event"],
      });
      expect(applyTurnLifecycleEnvelope).not.toHaveBeenCalled();
    },
  );
});
