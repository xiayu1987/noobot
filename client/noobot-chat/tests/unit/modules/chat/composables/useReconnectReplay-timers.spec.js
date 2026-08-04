/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixture, createFakeProcessStore } from "../helpers/useReconnectReplayHelper.js";
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("useReconnectReplay", () => {
  it("rejects the removed cache-expiration reconnect branch", async () => {
    const { api, mocks } = createFixture();

    await expect(api.applyReconnectData({ sessions: [], cacheExpired: true }))
      .rejects.toThrow("unsupported_reconnect_cache_branch");
    expect(mocks.chatList.fetchSessions).not.toHaveBeenCalled();
  });

  it("FN-02b: channel_state expired is ignored without refresh", async () => {
    const { api, mocks } = createFixture();
    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-exp",
      state: "expired",
      seq: 15,
    });

    expect(mocks.chatList.fetchSessions).not.toHaveBeenCalled();
  });

  it("FN-02c: channel_state no_conversation does not clear interaction state", async () => {
    const { api, refs, mocks } = createFixture();
    refs.interactionSubmitting.value = true;

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-none",
      state: "no_conversation",
      seq: 16,
    });

    expect(refs.interactionSubmitting.value).toBe(true);
    expect(mocks.clearPendingInteraction).not.toHaveBeenCalled();
  });

  it.each([
    StreamEventEnum.DONE,
    StreamEventEnum.USER_STOPPED,
    StreamEventEnum.ERROR,
  ])("FN-01: %s duplicate replay does not trigger terminal cleanup without channel_state", async (terminalEvent) => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-once", content: "A", pending: true },
    ];

    await api.applyReconnectEvent(terminalEvent, {
      sessionId: "s-1",
      dialogProcessId: "dp-once",
      seq: 2,
      ...(terminalEvent === StreamEventEnum.ERROR ? { error: "boom" } : {}),
    });
    await api.applyReconnectEvent(terminalEvent, {
      sessionId: "s-1",
      dialogProcessId: "dp-once",
      seq: 2,
      ...(terminalEvent === StreamEventEnum.ERROR ? { error: "boom" } : {}),
    });

    expect(mocks.clearPendingInteraction).not.toHaveBeenCalled();
  });
});
