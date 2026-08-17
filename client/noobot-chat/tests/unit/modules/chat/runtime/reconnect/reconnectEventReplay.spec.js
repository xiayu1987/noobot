/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyReconnectEventReplay } from "../../../../../../src/modules/chat/runtime/reconnect/reconnectEventReplay.js";
import { StreamEventEnum } from "../../../../../../src/modules/chat/model/chatConstants.js";
import { clearExtensionRegistry, replacePluginExtensions } from "../../../../../../src/extensions/extension-registry.js";
import { EXTENSION_POINTS } from "@noobot/plugin-protocol/frontend";
import { activate as activateWorkflowFrontend } from "../../../../../../../../plugin/noobot-plugin-workflow/frontend/index.js";
import { createTurnKey } from "../../../../../../src/modules/chat/runtime/engine/turnIdentity.js";
import { canonicalWorkflowRuntimeEvent } from "../../helpers/workflowRuntimeEventFixture.js";
import { WORKFLOW_RUNTIME_EVENT } from "@noobot/event-protocol/workflow-runtime-event";
import { createEventEnvelope, EVENT_FAMILY } from "@noobot/event-protocol";
import { TURN_LIFECYCLE_WIRE_EVENT } from "@noobot/session-protocol";
import { canonicalMessageEvent } from "../../helpers/messageEventFixture.js";

describe("applyReconnectEventReplay", () => {
  beforeEach(() => {
    const workflowContributions = [];
    void activateWorkflowFrontend({
      contributeExtension: (point, contribution) => {
        workflowContributions.push({ point, contribution });
        return true;
      },
      extensionPoints: EXTENSION_POINTS,
      services: {},
    });
    replacePluginExtensions("workflow", workflowContributions);
  });
  afterEach(() => clearExtensionRegistry());

  it.each([
    "workflow_planning_message_prepared",
    "workflow_node_state_committed",
  ])("routes %s directly to workflow runtime projection after reconnect", async (event) => {
    const data = {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      workflowRunId: "workflow-1",
      nodeSessions: [{ nodeExecutionId: "node-1" }],
      ...(event === WORKFLOW_RUNTIME_EVENT.PLANNING
        ? {
            presentationMessageId: "workflow-message-1",
            workflowPayload: { nodes: [{ nodeExecutionId: "node-1" }] },
          }
        : { status: "running" }),
    };
    const applyWorkflowRuntimeEvent = vi.fn(() => ({ applied: true }));
    const applyReconnectMessagesToActiveSession = vi.fn();

    const envelope = canonicalWorkflowRuntimeEvent(event, {
      ...data,
      authoritySessionId: data.sessionId,
      nodeExecutionId: "node-1",
      nodeSessionId: "node-session-1",
    });
    const result = await applyReconnectEventReplay({
      event: envelope.identity.eventType,
      data: envelope,
      replayCache: {},
      isCurrentActiveSession: vi.fn(() => true),
      consumeReplayCacheForSession: vi.fn(),
      applyReconnectMessagesToActiveSession,
      applyChannelState: vi.fn(),
      applyWorkflowRuntimeEvent,
    });

    expect(result).toEqual({ applied: true });
    expect(applyWorkflowRuntimeEvent).toHaveBeenCalledWith(envelope, { source: "reconnect" });
    expect(applyReconnectMessagesToActiveSession).not.toHaveBeenCalled();
  });

  it("routes authoritative TURN_LIFECYCLE envelopes directly to the lifecycle reducer", async () => {
    const replayCache = {};
    const applyTurnLifecycleEnvelope = vi.fn(() => ({ applied: true }));
    const lifecycle = {
      protocolVersion: 1,
      eventId: "event-1",
      messageId: "message-1",
      presentationMessageId: "presentation-1",
      eventType: "turn.processing_started",
      sessionId: "s-1",
      turnScopeId: "turn-1",
      phase: "processing",
      state: "processing",
      revision: 2,
      sequence: 2,
    };
    const envelope = createEventEnvelope({
      family: EVENT_FAMILY.TURN_LIFECYCLE,
      identity: {
        eventId: lifecycle.eventId,
        eventType: TURN_LIFECYCLE_WIRE_EVENT,
        sessionId: lifecycle.sessionId,
        turnScopeId: lifecycle.turnScopeId,
      },
      causality: {},
      ordering: { domain: "session", scopeId: lifecycle.sessionId, sequence: lifecycle.sequence, revision: lifecycle.revision },
      producer: { type: "test", id: "turn-lifecycle-fixture" },
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload: lifecycle,
    });

    const result = await applyReconnectEventReplay({
      event: StreamEventEnum.TURN_LIFECYCLE,
      data: envelope,
      replayCache,
      isCurrentActiveSession: vi.fn(() => false),
      consumeReplayCacheForSession: vi.fn(),
      applyReconnectMessagesToActiveSession: vi.fn(),
      applyChannelState: vi.fn(),
      applyTurnLifecycleEnvelope,
    });

    expect(result).toEqual({ applied: true });
    expect(applyTurnLifecycleEnvelope).toHaveBeenCalledOnce();
    expect(applyTurnLifecycleEnvelope).toHaveBeenCalledWith(envelope);
    expect(replayCache).toEqual({});
  });

  it("ignores CHANNEL_STATE because it is transport projection only", async () => {
    const replayCache = {};
    const consumeReplayCacheForSession = vi.fn();
    const applyReconnectMessagesToActiveSession = vi.fn();

    const result = await applyReconnectEventReplay({
      event: StreamEventEnum.CHANNEL_STATE,
      data: { state: "connected" },
      replayCache,
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
      messageId: "message-1",
      turnScopeId: "turn-1",
      dialogProcessId: "dp-1",
      text: "hello",
    });
    await applyReconnectEventReplay({
      event: envelope.identity.eventType,
      data: envelope,
      replayCache,
      isCurrentActiveSession: vi.fn((sessionId) => sessionId === "s-1"),
      consumeReplayCacheForSession,
      applyReconnectMessagesToActiveSession,
      applyChannelState: vi.fn(),
    });

    expect(consumeReplayCacheForSession).toHaveBeenCalledWith("s-1");
    expect(applyReconnectMessagesToActiveSession).toHaveBeenCalledWith(
      [envelope],
      "dp-1",
      { turnScopeId: "turn-1" },
    );
    expect(replayCache).toEqual({});
  });

  it("caches non-active session events by normalized replay key", async () => {
    const replayCache = {};

    const envelope = canonicalMessageEvent({
      eventType: "llm_delta",
      sessionId: "s-2",
      messageId: "message-2",
      turnScopeId: "turn-2",
      dialogProcessId: "dp-2",
      text: "cached",
    });
    await applyReconnectEventReplay({
      event: envelope.identity.eventType,
      data: envelope,
      replayCache,
      isCurrentActiveSession: vi.fn(() => false),
      consumeReplayCacheForSession: vi.fn(),
      applyReconnectMessagesToActiveSession: vi.fn(),
      applyChannelState: vi.fn(),
    });

    expect(replayCache).toEqual({
      "s-2": {
        [createTurnKey({ sessionId: "s-2", turnScopeId: "turn-2" })]: [
          envelope,
        ],
      },
    });
  });

  it("rejects dialog-only replay events without Session and Turn identity", async () => {
    const replayCache = {};
    const consumeReplayCacheForSession = vi.fn(async () => {});
    const applyReconnectMessagesToActiveSession = vi.fn(async () => {});

    await applyReconnectEventReplay({
      event: "message",
      data: { dialogProcessId: "dp-1", text: "tool running" },
      replayCache,
      isCurrentActiveSession: vi.fn(() => false),
      consumeReplayCacheForSession,
      applyReconnectMessagesToActiveSession,
      applyChannelState: vi.fn(),
    });

    expect(consumeReplayCacheForSession).not.toHaveBeenCalled();
    expect(applyReconnectMessagesToActiveSession).not.toHaveBeenCalled();
    expect(replayCache).toEqual({});
  });

});
