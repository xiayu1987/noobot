/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";

import {
  BackendChannelState,
  SESSION_RUN_EVENT,
} from "../../../../src/composables/chat/sessionRunStateMachine";
import { disposeReconnectReplayTimers } from "../../../../src/composables/chat/reconnectReplay/cleanup";
import { scheduleCacheExpiredSessionRefresh } from "../../../../src/composables/chat/reconnectReplay/cacheExpiredRefresh";
import { renderActiveSessionBeforeReplay } from "../../../../src/composables/chat/reconnectReplay/hydrationReplay";
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
    const interactionTimer = setTimeout(() => {}, 10000);
    const refreshTimer = setTimeout(() => {}, 10000);
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

  it("reuses recently loaded session detail when hydrating active session before replay", async () => {
    const detail = { sessionId: "s-1", sessions: [{ sessionId: "s-1", messages: [] }] };
    const fetchSessionDetail = vi.fn(async () => detail);
    const applySessionDetail = vi.fn();

    const result = await renderActiveSessionBeforeReplay({
      activeSession: { value: { id: "s-1", backendSessionId: "s-1", messages: [] } },
      activeSessionId: { value: "s-1" },
      chatList: { fetchSessionDetail, applySessionDetail },
    });

    expect(result).toBe(true);
    expect(fetchSessionDetail).toHaveBeenCalledWith("s-1", {
      source: "reconnectHydration",
      reuseRecentlyLoaded: true,
      allowLoadedSnapshot: true,
    });
    expect(applySessionDetail).toHaveBeenCalledWith(detail, { preserveCurrentMessages: true });
  });

  it("reports expired refresh failure when session refresh fails", async () => {
    vi.useFakeTimers();
    const sending = { value: true };
    const canStop = { value: true };
    const applyRunStateEvent = vi.fn();
    const clearPendingInteraction = vi.fn();
    const applyAssistantFailureState = vi.fn();
    const emitSyntheticErrorConversationState = vi.fn();
    const notify = vi.fn();
    const targetAssistantMessage = { role: "assistant", pending: true };

    scheduleCacheExpiredSessionRefresh({
      getCacheExpiredRefreshTimer: vi.fn(() => null),
      setCacheExpiredRefreshTimer: vi.fn(),
      replayCache: {},
      sending,
      canStop,
      interactionSubmitting: { value: true },
      clearPendingInteraction,
      translate: vi.fn((key) => `translated:${key}`),
      activeSession: { value: { id: "active-s", messages: [] } },
      activeSessionId: { value: "active-s" },
      chatList: { fetchSessions: vi.fn(async () => false) },
      applyRunStateEvent,
      applyAssistantFailureState,
      emitSyntheticErrorConversationState,
      notify,
      sessionId: " failed-s ",
      dialogProcessId: "dp-failed",
      targetAssistantMessage,
    });

    await vi.advanceTimersByTimeAsync(1200);

    expect(applyRunStateEvent).toHaveBeenCalledWith({
      type: SESSION_RUN_EVENT.LOCAL_FAILURE,
      state: BackendChannelState.ERROR,
      sessionId: "failed-s",
      dialogProcessId: "dp-failed",
      source: "expired_refresh_failed",
    });
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
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

  it("falls back to closing sending/canStop when expired refresh fails without state machine bridge", async () => {
    vi.useFakeTimers();
    const sending = { value: true };
    const canStop = { value: true };

    scheduleCacheExpiredSessionRefresh({
      getCacheExpiredRefreshTimer: vi.fn(() => null),
      setCacheExpiredRefreshTimer: vi.fn(),
      replayCache: {},
      sending,
      canStop,
      interactionSubmitting: { value: true },
      clearPendingInteraction: vi.fn(),
      translate: vi.fn((key) => key),
      activeSession: { value: { id: "active-s", messages: [] } },
      activeSessionId: { value: "active-s" },
      chatList: { fetchSessions: vi.fn(async () => false) },
      applyAssistantFailureState: vi.fn(),
      emitSyntheticErrorConversationState: vi.fn(),
      notify: vi.fn(),
      sessionId: "failed-s",
      dialogProcessId: "dp-fallback",
    });

    await vi.advanceTimersByTimeAsync(1200);

    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);
    vi.useRealTimers();
  });
});
