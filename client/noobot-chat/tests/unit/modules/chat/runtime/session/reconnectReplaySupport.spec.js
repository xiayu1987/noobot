/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";

import {
  BackendChannelState,
  SESSION_RUN_EVENT,
} from "../../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import { disposeReconnectReplayTimers } from "../../../../../../src/modules/chat/runtime/reconnect/cleanup.js";
import { scheduleCacheExpiredSessionRefresh } from "../../../../../../src/modules/chat/runtime/reconnect/cacheExpiredRefresh.js";
import { renderActiveSessionBeforeReplay } from "../../../../../../src/modules/chat/runtime/reconnect/hydrationReplay.js";
import { createReconnectReplayPublicApi } from "../../../../../../src/modules/chat/runtime/reconnect/publicApi.js";

describe("reconnectReplay support modules", () => {
  it("exposes test internals only in test mode", () => {
    const internals = {
      replayCache: { "s-1": {} },
      appliedReconnectSeqByDialogProcessId: { "dp-1": 1 },
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
      missingInteractionPayloadTimers,
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
    });
    vi.useRealTimers();
  });

  it("fetches fresh session detail when hydrating active session before replay", async () => {
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
      source: "reconnectProtocolReconcile",
    });
    expect(applySessionDetail).toHaveBeenCalledWith(detail);
  });

  it("does not hydrate a local Session from its client identity", async () => {
    const fetchSessionDetail = vi.fn();
    const result = await renderActiveSessionBeforeReplay({
      activeSession: { value: { id: "local-1", backendSessionId: "", isLocal: true, messages: [] } },
      activeSessionId: { value: "local-1" },
      chatList: { fetchSessionDetail, applySessionDetail: vi.fn() },
    });

    expect(result).toBe(false);
    expect(fetchSessionDetail).not.toHaveBeenCalled();
  });

  it.each([
    ["empty detail", { sessions: [] }],
    ["mismatched top-level identity", { sessionId: "s-other", sessions: [{ sessionId: "s-other" }] }],
    ["mismatched session document", { sessionId: "s-1", sessions: [{ sessionId: "s-other" }] }],
  ])("rejects %s before applying reconnect hydration", async (_label, detail) => {
    const applySessionDetail = vi.fn();
    const result = await renderActiveSessionBeforeReplay({
      activeSession: { value: { id: "s-1", backendSessionId: "s-1", messages: [] } },
      activeSessionId: { value: "s-1" },
      chatList: {
        fetchSessionDetail: vi.fn(async () => detail),
        applySessionDetail,
      },
    });

    expect(result).toBe(false);
    expect(applySessionDetail).not.toHaveBeenCalled();
  });

  it("does not apply hydration after the active session changes during the request", async () => {
    const activeSession = { value: { id: "s-1", backendSessionId: "s-1", messages: [] } };
    const applySessionDetail = vi.fn();
    const result = await renderActiveSessionBeforeReplay({
      activeSession,
      activeSessionId: { value: "s-1" },
      chatList: {
        fetchSessionDetail: vi.fn(async () => {
          activeSession.value = { id: "s-2", backendSessionId: "s-2", messages: [] };
          return { sessionId: "s-1", sessions: [{ sessionId: "s-1", messages: [] }] };
        }),
        applySessionDetail,
      },
    });

    expect(result).toBe(false);
    expect(applySessionDetail).not.toHaveBeenCalled();
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

    expect(applyRunStateEvent).not.toHaveBeenCalled();
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
    expect(clearPendingInteraction).toHaveBeenCalledTimes(1);
    expect(applyAssistantFailureState).not.toHaveBeenCalled();
    expect(emitSyntheticErrorConversationState).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith({
      type: "error",
      message: "translated:chat.expiredRefreshFailed",
    });
    vi.useRealTimers();
  });

});
