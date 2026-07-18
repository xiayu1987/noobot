/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createHarness, assistantMessage, emitChannelState } from "./helpers/useChatEngineHarness";
import { StreamEventEnum, RoleEnum } from "../../../../src/shared/constants/chatConstants";

describe("useChatEngine.interaction-stop: interaction", () => {
  it("expired channel_state schedules session refresh", async () => {
    vi.useFakeTimers();
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
    await vi.advanceTimersByTimeAsync(1300);

    expect(deps.clearPendingInteraction).toHaveBeenCalled();
    expect(refreshSessionsAsync).toHaveBeenCalledTimes(1);
    expect(refreshSessionsAsync).toHaveBeenCalledWith("local-expired", {
      silent: true,
      preserveCurrentMessages: true,
    });
    vi.useRealTimers();
  });

  it("channel_state interaction_pending restores pending interaction payload", async () => {
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
        pendingInteraction,
      });
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

  it("channel_state sending does not clear interaction unless sourceEvent is interaction_response", async () => {
    const clearPendingInteractionIfObsolete = vi.fn();
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-int-send", "dp-int-send", "interaction_pending", {
        seq: 1,
        pendingInteraction: {
          requestId: "req-int-send",
          sessionId: "local-int-send",
          dialogProcessId: "dp-int-send",
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
    expect(canStop.value).toBe(true);
    expect(assistant?.pending).toBe(true);
    expect(notify).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1200);

    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.failed");
    expect(assistant?.error).toBe("chat.interactionPayloadMissing");
    expect(notify).toHaveBeenCalledWith({
      type: "error",
      message: "chat.interactionPayloadMissing",
    });
    vi.useRealTimers();
  });

  it("expired refresh failure falls back to error state", async () => {
    vi.useFakeTimers();
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
    await vi.advanceTimersByTimeAsync(1300);

    const assistant = assistantMessage(activeSession);
    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.failed");
    expect(assistant?.error).toBe("chat.expiredRefreshFailed");
    expect(notify).toHaveBeenCalledWith({
      type: "error",
      message: "chat.expiredRefreshFailed",
    });
    vi.useRealTimers();
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
});
