/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixture, createFakeProcessStore } from "./helpers/useReconnectReplayHelper";
import { RoleEnum, StreamEventEnum } from "../../../../src/shared/constants/chatConstants";

afterEach(() => {
  vi.useRealTimers();
});

describe("useReconnectReplay", () => {
  it("副作用顺序: appendMessage -> scrollBottom; terminal cleanup由channel_state触发", async () => {
    const { api, mocks } = createFixture();
    await api.applyReconnectData({
      sessions: [
        {
          sessionId: "s-1",
          currentRun: { sessionId: "s-1", dialogProcessId: "dp-order", turnScopeId: "turn-order", state: "error", seq: 3 },
          dialogProcesses: [
            {
              dialogProcessId: "dp-order",
              messages: [
                { event: StreamEventEnum.DELTA, data: { seq: 1, text: "A", dialogProcessId: "dp-order" } },
                { event: StreamEventEnum.ERROR, data: { seq: 2, error: "x", dialogProcessId: "dp-order" } },
              ],
            },
          ],
          conversationStates: [
            { sessionId: "s-1", dialogProcessId: "dp-order", state: "error", seq: 3 },
          ],
        },
      ],
    });

    expect(mocks.appendMessage).toHaveBeenCalled();
    expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalled();
    expect(mocks.scrollBottom).not.toHaveBeenCalled();
  });

  it("interaction_pending without pendingInteraction falls back to error state", async () => {
    vi.useFakeTimers();
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, content: "", pending: true, statusLabel: "", turnScopeId: "turn-missing" },
    ];

    await api.applyReconnectData({
      sessions: [
        {
          sessionId: "s-1",
          currentRun: { sessionId: "s-1", dialogProcessId: "dp-missing", turnScopeId: "turn-missing", state: "interaction_pending", seq: 10 },
          conversationStates: [
            {
              sessionId: "s-1",
              dialogProcessId: "dp-missing",
              state: "interaction_pending",
              seq: 10,
            },
          ],
          dialogProcesses: [],
        },
      ],
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT,
    );
    expect(refs.sending.value).toBe(true);
    expect(mocks.notify).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1200);

    expect(refs.sending.value).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.failed");
    expect(assistant?.error).toBe("chat.interactionPayloadMissing");
    expect(mocks.notify).toHaveBeenCalledWith({
      type: "error",
      message: "chat.interactionPayloadMissing",
    });
    vi.useRealTimers();
  });

  it("interaction_pending without pendingInteraction waits for later interaction_request", async () => {
    vi.useFakeTimers();
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, content: "", pending: true, statusLabel: "", turnScopeId: "turn-missing" },
    ];

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-late",
      state: "interaction_pending",
      seq: 10,
    });
    await api.applyReconnectEvent(StreamEventEnum.INTERACTION_REQUEST, {
      requestId: "req-late",
      sessionId: "s-1",
      dialogProcessId: "dp-late",
      interactionType: "confirm",
      content: "continue?",
    });

    await vi.advanceTimersByTimeAsync(1200);

    expect(mocks.setPendingInteractionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-late",
        dialogProcessId: "dp-late",
      }),
    );
    expect(refs.sending.value).toBe(true);
    expect(mocks.notify).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("expired refresh failure falls back to error state", async () => {
    vi.useFakeTimers();
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, content: "", pending: true, statusLabel: "", turnScopeId: "turn-expired" },
    ];
    mocks.chatList.fetchSessions.mockResolvedValue(false);

    await api.applyReconnectData({
      sessions: [
        {
          sessionId: "s-1",
          currentRun: { sessionId: "s-1", dialogProcessId: "dp-expired", turnScopeId: "turn-expired", state: "expired", seq: 11 },
          conversationStates: [
            {
              sessionId: "s-1",
              dialogProcessId: "dp-expired",
              state: "expired",
              seq: 11,
            },
          ],
          dialogProcesses: [],
        },
      ],
    });

    await vi.advanceTimersByTimeAsync(1300);

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT,
    );
    expect(refs.sending.value).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.failed");
    expect(assistant?.error).toBe("chat.expiredRefreshFailed");
    expect(mocks.notify).toHaveBeenCalledWith({
      type: "error",
      message: "chat.expiredRefreshFailed",
    });
    vi.useRealTimers();
  });
});
