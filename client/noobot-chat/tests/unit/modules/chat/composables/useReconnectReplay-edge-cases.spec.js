/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthoritativeMessageEnvelope,
  createCanonicalAssistant,
  createFixture,
  createFakeProcessStore,
  createInteractionEnvelope,
} from "../helpers/useReconnectReplayHelper.js";
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("useReconnectReplay", () => {
  it("transport channel_state has no Authority or message side effects", async () => {
    const { api, refs, mocks } = createFixture();
    const assistant = createCanonicalAssistant({
      messageId: "message-order",
      dialogProcessId: "dp-order",
      turnScopeId: "turn-order",
    });
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      assistant,
    ];
    const result = await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1", dialogProcessId: "dp-order", turnScopeId: "turn-order",
      state: "error", seq: 3,
    });

    expect(result).toEqual({ applied: false, reason: "transport_channel_state_ignored" });
    expect(assistant.content).toBe("");
    expect(mocks.appendMessage).not.toHaveBeenCalled();
    expect(mocks.resolveTurnTerminalState).not.toHaveBeenCalled();
    expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();
    expect(mocks.scrollBottom).not.toHaveBeenCalled();
  });

  it("a reconnect entry without a valid Replay Batch is reconciled without creating a Turn", async () => {
    vi.useFakeTimers();
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, content: "", pending: true, statusLabel: "", turnScopeId: "turn-missing" },
    ];

    await api.applyReconnectData({ sessions: [{ sessionId: "s-1" }] });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT,
    );
    expect(refs.sending.value).toBe(false);
    expect(mocks.notify).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1200);
    expect(assistant?.statusLabel).toBe("");
    expect(assistant?.error).toBeUndefined();
    expect(mocks.clearPendingInteraction).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("an interaction request is only accepted as a complete protocol record", async () => {
    vi.useFakeTimers();
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, content: "", pending: true, statusLabel: "", turnScopeId: "turn-missing" },
    ];

    const interaction = createInteractionEnvelope({
      requestId: "req-late",
      dialogProcessId: "dp-late",
      interactionType: "confirm",
      content: "continue?",
    }, { sessionId: "s-1", turnScopeId: "turn-missing" });
    const result = await api.applyReconnectEvent(
      interaction.identity.eventType,
      interaction,
    );

    expect(result?.applied).not.toBe(false);
    expect(mocks.setPendingInteractionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-late",
        dialogProcessId: "dp-late",
      }),
    );
    // An interaction record is not a lifecycle event.  It registers the
    // pending interaction only; running/stop capabilities come from the
    // authoritative Turn snapshot.
    expect(refs.sending.value).toBe(false);
    expect(mocks.notify).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

});
