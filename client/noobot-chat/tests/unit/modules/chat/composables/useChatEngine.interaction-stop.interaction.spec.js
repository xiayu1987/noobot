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
import { StreamEventEnum, RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import {
  createEventEnvelope,
  EVENT_FAMILY,
  INTERACTION_SEQUENCE_DOMAIN,
} from "@noobot/event-protocol";

describe("useChatEngine.interaction-stop: interaction", () => {
  it("expired channel_state does not start a session-refresh recovery branch", async () => {
    const refreshSessionsAsync = vi.fn(async () => {});
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-expired", "dp-expired", "expired");
      onEvent({
        event: StreamEventEnum.USER_STOPPED,
        data: { sessionId: "local-expired", dialogProcessId: "dp-expired" },
      });
    });
    const { engine, deps } = createHarness({
      sessionId: "local-expired",
      stream,
      pendingInteraction: {
        requestId: "req-1",
        sessionId: "local-expired",
        dialogProcessId: "dp-expired",
      },
      interactionSubmittingValue: true,
      deps: {
        refreshSessionsAsync,
        clearPendingInteractionIfObsolete: vi.fn(() => true),
      },
    });

    await engine.send();

    expect(deps.clearPendingInteraction).toHaveBeenCalled();
    expect(refreshSessionsAsync).not.toHaveBeenCalled();
  });

  it("interaction_request is the only event that restores a pending interaction", async () => {
    const setPendingInteractionRequest = vi.fn();
    const pendingInteraction = {
      requestId: "req-int",
      sessionId: "local-int",
      dialogProcessId: "dp-int",
      interactionType: "confirm",
      content: "confirm?",
    };
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-int", "dp-int", "interaction_pending", {
        seq: 2,
      });
      onEvent({ event: StreamEventEnum.INTERACTION_REQUEST, data: pendingInteraction });
      emitChannelState(onEvent, "local-int", "dp-int", "user_stopped", { seq: 3 });
      onEvent({
        event: StreamEventEnum.USER_STOPPED,
        data: { sessionId: "local-int", dialogProcessId: "dp-int" },
      });
    });
    const { engine, interactionSubmitting } = createHarness({
      sessionId: "local-int",
      stream,
      deps: { setPendingInteractionRequest },
    });

    await engine.send();

    expect(setPendingInteractionRequest).toHaveBeenCalledTimes(1);
    expect(setPendingInteractionRequest.mock.calls[0][0]).toMatchObject(pendingInteraction);
    expect(interactionSubmitting.value).toBe(false);
  });

  it("routes a child interaction by explicit channel identity while preserving child authority", async () => {
    const setPendingInteractionRequest = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      const interaction = createEventEnvelope({
        family: EVENT_FAMILY.INTERACTION_REQUEST,
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

    await engine.send();

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
        data: {
          requestId: "req-int-send",
          sessionId: "local-int-send",
          dialogProcessId: "dp-int-send",
          turnScopeId: "turn-int-send",
          interactionType: "confirm",
          content: "confirm?",
        },
      });
      emitChannelState(onEvent, "local-int-send", "dp-int-send", "sending", { seq: 2 });
      emitChannelState(onEvent, "local-int-send", "dp-int-send", "sending", {
        sourceEvent: "interaction_response",
        requestId: "req-int-send",
        seq: 3,
      });
    });
    const { engine } = createHarness({
      sessionId: "local-int-send",
      stream,
      deps: { clearPendingInteractionIfObsolete },
    });

    await engine.send();

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

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(false);
    expect(assistant?.pending).toBe(false);
    expect(notify).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1200);

    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(false);
    expect(assistant?.pending).toBe(false);
    expect(assistant?.terminalOutcome).toBe("");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      type: "error",
      message: "chat.interactionPayloadMissing",
    });
    vi.useRealTimers();
  });

  it("expired transport state does not manufacture a refresh failure", async () => {
    const notify = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-expired-fail", "dp-expired-fail", "expired", {
        seq: 2,
      });
    });
    const { engine, activeSession, sending, canStop } = createHarness({
      sessionId: "local-expired-fail",
      stream,
      deps: {
        notify,
        refreshSessionsAsync: vi.fn(async () => false),
      },
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);

    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(false);
    expect(assistant?.terminalOutcome).not.toBe("generated");
    expect(assistant?.error).not.toBe("chat.expiredRefreshFailed");
    expect(notify).not.toHaveBeenCalled();
  });

  it("interaction_request with lifecycle=resolved & ackMode=auto should auto ack and not enter pending", async () => {
    const setPendingInteractionRequest = vi.fn();
    const submitInteractionResponse = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.INTERACTION_REQUEST,
        data: {
          sessionId: "local-auto-resolved",
          dialogProcessId: "dp-auto",
          requestId: "req-auto",
          interactionType: "post_action_notice",
          lifecycle: "resolved",
          ackMode: "auto",
          content: "done",
        },
      });
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "local-auto-resolved",
          dialogProcessId: "dp-auto",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-auto", content: "ok" },
          ],
        },
      });
    });
    const { engine } = createHarness({
      sessionId: "local-auto-resolved",
      stream,
      deps: {
        connectorTypeSet: new Set(["email"]),
        setPendingInteractionRequest,
        submitInteractionResponse,
      },
    });

    await engine.send();

    expect(setPendingInteractionRequest).not.toHaveBeenCalled();
    expect(submitInteractionResponse).toHaveBeenCalledTimes(1);
    expect(submitInteractionResponse.mock.calls[0][0]).toMatchObject({
      confirmed: true,
      response: "post_action_notice_ack",
    });
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
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({ event: StreamEventEnum.INTERACTION_REQUEST, data: failedRequest });
    });
    const { engine } = createHarness({
      sessionId: "local-timeout",
      stream,
      deps: { clearPendingInteraction, setPendingInteractionRequest },
    });

    await engine.send();

    expect(clearPendingInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-timeout",
        lifecycle: "failed",
      }),
    );
    expect(setPendingInteractionRequest).not.toHaveBeenCalled();
  });
});
