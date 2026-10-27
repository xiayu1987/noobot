/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  createHarness,
  assistantMessage,
  emitChannelState,
} from "../helpers/useChatEngineHarness.js";
import { StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import {
  createEventEnvelope,
  EVENT_FAMILY,
  INTERACTION_SEQUENCE_DOMAIN,
  getEventFamily,
} from "@noobot/event-protocol";
import { AGENT_COMMAND } from "@noobot/agent-transport-protocol";

const SEND_REQUEST = Object.freeze({ commandType: AGENT_COMMAND.SEND });

const interactionEnvelope = ({ sessionId, turnScopeId, ...payload }) =>
  createEventEnvelope({
    family: EVENT_FAMILY.INTERACTION_REQUEST,
    schemaVersion: getEventFamily(EVENT_FAMILY.INTERACTION_REQUEST).schemaVersion,
    identity: {
      eventId: `${payload.requestId}-event`,
      eventType: StreamEventEnum.INTERACTION_REQUEST,
      sessionId,
      turnScopeId,
    },
    causality: {},
    ordering: {
      domain: INTERACTION_SEQUENCE_DOMAIN,
      scopeId: payload.requestId,
      sequence: 1,
    },
    producer: { type: "test", id: "interaction-stop-spec" },
    occurredAt: "2026-09-19T00:00:00.000Z",
    payload,
  });

describe("useChatEngine.interaction-stop: interaction", () => {
  it("interaction_request is the only event that restores a pending interaction", async () => {
    const setPendingInteractionRequest = vi.fn();
    const pendingInteraction = {
      requestId: "req-int",
      sessionId: "local-int",
      dialogProcessId: "dp-int",
      interactionType: "confirm",
      content: "confirm?",
    };
    const stream = vi.fn(async (payload, onEvent) => {
      emitChannelState(onEvent, "local-int", "dp-int", "interaction_pending", {
        seq: 2,
      });
      onEvent({
        event: StreamEventEnum.INTERACTION_REQUEST,
        data: interactionEnvelope({
          ...pendingInteraction,
          turnScopeId: payload.identity.turnScopeId,
        }),
        channelSessionId: payload.identity.sessionId,
      });
      emitChannelState(onEvent, "local-int", "dp-int", "user_stopped", { seq: 3 });
    });
    const { engine, interactionSubmitting } = createHarness({
      sessionId: "local-int",
      stream,
      deps: { setPendingInteractionRequest },
    });

    await engine.send(SEND_REQUEST);

    expect(setPendingInteractionRequest).toHaveBeenCalledTimes(1);
    expect(setPendingInteractionRequest.mock.calls[0][0]).toMatchObject(pendingInteraction);
    expect(interactionSubmitting.value).toBe(false);
  });

  it("routes a child interaction by explicit channel identity while preserving child authority", async () => {
    const setPendingInteractionRequest = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      const interaction = createEventEnvelope({
        family: EVENT_FAMILY.INTERACTION_REQUEST,
        schemaVersion: getEventFamily(EVENT_FAMILY.INTERACTION_REQUEST).schemaVersion,
        identity: {
          eventId: "child-interaction-event",
          eventType: StreamEventEnum.INTERACTION_REQUEST,
          sessionId: "child-session",
          turnScopeId: "child-turn",
        },
        causality: {},
        ordering: {
          domain: INTERACTION_SEQUENCE_DOMAIN,
          scopeId: "child-request",
          sequence: 1,
        },
        producer: { type: "test", id: "child-interaction" },
        occurredAt: "2026-09-19T00:00:00.000Z",
        payload: {
          requestId: "child-request",
          dialogProcessId: "child-dialog",
          content: "CASE051-MCP-CHILD-INTERACTION",
          fields: [{ name: "verificationCode", required: true }],
          lifecycle: "pending",
        },
      });
      onEvent({
        event: StreamEventEnum.INTERACTION_REQUEST,
        data: interaction,
        channelSessionId: "root-session",
      });
    });
    const { engine } = createHarness({
      sessionId: "root-session",
      stream,
      deps: { setPendingInteractionRequest },
    });

    await engine.send(SEND_REQUEST);

    expect(setPendingInteractionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "child-request",
        sessionId: "child-session",
        channelSessionId: "root-session",
        turnScopeId: "child-turn",
      }),
    );
  });

  it("channel_state sending does not clear interaction unless sourceEvent is interaction_response", async () => {
    const clearPendingInteractionIfObsolete = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-int-send", "dp-int-send", "interaction_pending", {
        seq: 1,
      });
      onEvent({
        event: StreamEventEnum.INTERACTION_REQUEST,
        data: interactionEnvelope({
          requestId: "req-int-send",
          sessionId: "local-int-send",
          dialogProcessId: "dp-int-send",
          turnScopeId: "turn-int-send",
          interactionType: "confirm",
          content: "confirm?",
        }),
        channelSessionId: "local-int-send",
      });
      emitChannelState(onEvent, "local-int-send", "dp-int-send", "sending", { seq: 2 });
      emitChannelState(onEvent, "local-int-send", "dp-int-send", "sending", {
        sourceEvent: AGENT_COMMAND.INTERACTION_RESPONSE,
        requestId: "req-int-send",
        seq: 3,
      });
    });
    const { engine } = createHarness({
      sessionId: "local-int-send",
      stream,
      deps: { clearPendingInteractionIfObsolete },
    });

    await engine.send(SEND_REQUEST);

    expect(clearPendingInteractionIfObsolete).toHaveBeenCalledTimes(1);
    expect(clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      requestId: "req-int-send",
    });
  });

  it("interaction_pending without pendingInteraction falls back to error state", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-missing", "dp-missing", "interaction_pending", {
        seq: 2,
      });
    });
    const { engine, activeSession, sending, canStop } = createHarness({
      sessionId: "local-missing",
      stream,
      deps: { notify },
    });

    await engine.send(SEND_REQUEST);

    const assistant = assistantMessage(activeSession);
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(false);
    expect(assistant).not.toHaveProperty("pending");
    expect(notify).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1200);

    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(false);
    expect(assistant).not.toHaveProperty("pending");
    expect(assistant).not.toHaveProperty("terminalOutcome");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      type: "error",
      message: "chat.interactionPayloadMissing",
    });
    vi.useRealTimers();
  });

  it("failed interaction lifecycle clears the pending modal after timeout", async () => {
    const clearPendingInteraction = vi.fn();
    const setPendingInteractionRequest = vi.fn();
    const failedRequest = {
      sessionId: "local-timeout",
      dialogProcessId: "dp-timeout",
      requestId: "req-timeout",
      interactionType: "user_interaction",
      lifecycle: "failed",
      resolvedBy: "system",
      interactionData: { reason: "timeout" },
    };
    const stream = vi.fn(async (payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.INTERACTION_REQUEST,
        data: interactionEnvelope({
          ...failedRequest,
          turnScopeId: payload.identity.turnScopeId,
        }),
        channelSessionId: payload.identity.sessionId,
      });
    });
    const { engine } = createHarness({
      sessionId: "local-timeout",
      stream,
      deps: { clearPendingInteraction, setPendingInteractionRequest },
    });

    await engine.send(SEND_REQUEST);

    expect(clearPendingInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-timeout",
        lifecycle: "failed",
      }),
    );
    expect(setPendingInteractionRequest).not.toHaveBeenCalled();
  });

  it("channel_state without an active session is reported as not applied and skips state handling", async () => {
    const onConversationState = vi.fn();
    const clearPendingInteractionIfObsolete = vi.fn();
    let activeSessionIdRef = null;
    const stream = vi.fn(async (_payload, onEvent) => {
      activeSessionIdRef.value = "session-not-in-list";
      emitChannelState(onEvent, "local-no-active", "dp-no-active", "sending", {
        sourceEvent: AGENT_COMMAND.INTERACTION_RESPONSE,
        requestId: "req-no-active",
        seq: 2,
      });
    });
    const harness = createHarness({
      sessionId: "local-no-active",
      stream,
      deps: { onConversationState, clearPendingInteractionIfObsolete },
    });
    activeSessionIdRef = harness.activeSessionId;

    await harness.engine.send(SEND_REQUEST);

    expect(harness.activeSession.value).toBeNull();
    expect(onConversationState).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "stream",
        sessionId: "local-no-active",
        applied: false,
      }),
    );
    expect(clearPendingInteractionIfObsolete).not.toHaveBeenCalled();
  });
});
