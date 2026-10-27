/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateReconnectData } from "@noobot/agent-transport-protocol";
import { createFixture } from "../helpers/useReconnectReplayHelper.js";
import { StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("useReconnectReplay", () => {
  it("rejects the removed cache-expiration reconnect branch at the protocol", () => {
    const result = validateReconnectData({
      requestId: "reconnect-s-1",
      identity: { sessionId: "s-1", parentSessionId: "" },
      sessions: [],
      cacheExpired: true,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("unknown_field:cacheExpired");
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
    const { api, mocks } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-none",
      state: "no_conversation",
      seq: 16,
    });

    expect(mocks.clearPendingInteraction).not.toHaveBeenCalled();
  });
});
