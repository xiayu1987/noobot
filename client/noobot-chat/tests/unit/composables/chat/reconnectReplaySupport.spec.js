import { describe, expect, it, vi } from "vitest";

import { disposeReconnectReplayTimers } from "../../../../src/composables/chat/reconnectReplay/cleanup";
import { scheduleCacheExpiredSessionRefresh } from "../../../../src/composables/chat/reconnectReplay/cacheExpiredRefresh";
import { createReconnectReplayPublicApi } from "../../../../src/composables/chat/reconnectReplay/publicApi";

describe("reconnectReplay support modules", () => {
  it("exposes test internals only in test mode", () => {
    const internals = {
      replayCache: { "s-1": {} },
      appliedReconnectSeqByDialogProcessId: { "dp-1": 1 },
      terminalDialogProcessIdSet: new Set(["dp-1"]),
    };

    const api = createReconnectReplayPublicApi({
      applyReconnectData: vi.fn(),
      applyReconnectEvent: vi.fn(),
      applyChannelState: vi.fn(),
      ...internals,
      isTestMode: true,
    });
    const productionApi = createReconnectReplayPublicApi({
      applyReconnectData: vi.fn(),
      applyReconnectEvent: vi.fn(),
      applyChannelState: vi.fn(),
      ...internals,
      isTestMode: false,
    });

    expect(api.__test).toEqual(internals);
    expect(productionApi.__test).toBeUndefined();
  });

  it("clears pending interaction timers and cache expired refresh timer on cleanup", () => {
    vi.useFakeTimers();
    const interactionTimer = setTimeout(() => {}, 10_000);
    const refreshTimer = setTimeout(() => {}, 10_000);
    const missingInteractionPayloadTimers = new Map([["dp-1", interactionTimer]]);
    const setCacheExpiredRefreshTimer = vi.fn();

    disposeReconnectReplayTimers({
      missingInteractionPayloadTimers,
      getCacheExpiredRefreshTimer: () => refreshTimer,
      setCacheExpiredRefreshTimer,
    });

    expect(missingInteractionPayloadTimers.size).toBe(0);
    expect(setCacheExpiredRefreshTimer).toHaveBeenCalledWith(null);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("refreshes sessions after cache expiration and clears replay cache", async () => {
    vi.useFakeTimers();
    const replayCache = { "s-1": { "dp-1": [] }, "s-2": { "dp-2": [] } };
    const timerState = { value: null };
    const fetchSessions = vi.fn(async () => true);

    scheduleCacheExpiredSessionRefresh({
      getCacheExpiredRefreshTimer: () => timerState.value,
      setCacheExpiredRefreshTimer: (timer) => {
        timerState.value = timer;
      },
      replayCache,
      sending: { value: true },
      interactionSubmitting: { value: true },
      clearPendingInteraction: vi.fn(),
      translate: vi.fn((key) => key),
      activeSession: { value: { id: "s-1", messages: [] } },
      activeSessionId: { value: " s-1 " },
      chatList: { fetchSessions },
      applyAssistantFailureState: vi.fn(),
      emitSyntheticErrorConversationState: vi.fn(),
      notify: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(1200);

    expect(timerState.value).toBe(null);
    expect(replayCache).toEqual({});
    expect(fetchSessions).toHaveBeenCalledWith("s-1", {
      silent: true,
      preserveCurrentMessages: true,
    });
    vi.useRealTimers();
  });

  it("reports expired refresh failure when session refresh fails", async () => {
    vi.useFakeTimers();
    const clearPendingInteraction = vi.fn();
    const applyAssistantFailureState = vi.fn();
    const emitSyntheticErrorConversationState = vi.fn();
    const notify = vi.fn();
    const targetAssistantMessage = { role: "assistant", pending: true };

    scheduleCacheExpiredSessionRefresh({
      getCacheExpiredRefreshTimer: vi.fn(() => null),
      setCacheExpiredRefreshTimer: vi.fn(),
      replayCache: {},
      sending: { value: true },
      interactionSubmitting: { value: true },
      clearPendingInteraction,
      translate: vi.fn((key) => `translated:${key}`),
      activeSession: { value: { id: "active-s", messages: [] } },
      activeSessionId: { value: "active-s" },
      chatList: { fetchSessions: vi.fn(async () => false) },
      applyAssistantFailureState,
      emitSyntheticErrorConversationState,
      notify,
      sessionId: " failed-s ",
      dialogProcessId: "dp-failed",
      targetAssistantMessage,
    });

    await vi.advanceTimersByTimeAsync(1200);

    expect(clearPendingInteraction).toHaveBeenCalledTimes(1);
    expect(applyAssistantFailureState).toHaveBeenCalledWith(
      targetAssistantMessage,
      "translated:chat.expiredRefreshFailed",
    );
    expect(emitSyntheticErrorConversationState).toHaveBeenCalledWith({
      sessionId: "failed-s",
      dialogProcessId: "dp-failed",
      sourceEvent: "expired_refresh_failed",
    });
    expect(notify).toHaveBeenCalledWith({
      type: "error",
      message: "translated:chat.expiredRefreshFailed",
    });
    vi.useRealTimers();
  });
});
