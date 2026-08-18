/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";

import { renderActiveSessionBeforeReplay } from "../../../../../../src/modules/chat/runtime/reconnect/hydrationReplay.js";
import { createReconnectReplayPublicApi } from "../../../../../../src/modules/chat/runtime/reconnect/publicApi.js";

describe("reconnectReplay support modules", () => {
  it("exposes test internals only in test mode", () => {
    const internals = {
      replayCache: { "s-1": {} },
      appliedReconnectSequenceByTurnKey: { "__turn__s-1::turn-1": 1 },
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

    expect(api.__test).toEqual({ replayCache: internals.replayCache });
    expect(productionApi.__test).toBeUndefined();
  });

  it("fetches fresh session detail when hydrating active session before replay", async () => {
    const detail = { sessionId: "s-1", sessions: [{ sessionId: "s-1", messages: [] }] };
    const fetchSessionDetail = vi.fn(async () => detail);
    const applySessionDetail = vi.fn();

    const result = await renderActiveSessionBeforeReplay({
      activeSession: { value: { id: "s-1", sessionId: "s-1", messages: [] } },
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
      activeSession: { value: { id: "local-1", sessionId: "", isLocal: true, messages: [] } },
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
      activeSession: { value: { id: "s-1", sessionId: "s-1", messages: [] } },
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
    const activeSession = { value: { id: "s-1", sessionId: "s-1", messages: [] } };
    const applySessionDetail = vi.fn();
    const result = await renderActiveSessionBeforeReplay({
      activeSession,
      activeSessionId: { value: "s-1" },
      chatList: {
        fetchSessionDetail: vi.fn(async () => {
          activeSession.value = { id: "s-2", sessionId: "s-2", messages: [] };
          return { sessionId: "s-1", sessions: [{ sessionId: "s-1", messages: [] }] };
        }),
        applySessionDetail,
      },
    });

    expect(result).toBe(false);
    expect(applySessionDetail).not.toHaveBeenCalled();
  });

});
