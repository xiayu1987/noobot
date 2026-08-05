/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createReconnectCoordinator } from "../../../../../../src/modules/chat/runtime/session/reconnectCoordinator.js";
import { createTurnRuntimeRegistryState } from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";

describe("createReconnectCoordinator", () => {
  it("does not reconnect a local Session without a backend identity", async () => {
    const chatWebSocketClient = { reconnect: vi.fn() };
    const coordinator = createReconnectCoordinator({
      activeSession: ref({ id: "local-1", sessionId: "", isLocal: true, messages: [] }),
      activeSessionId: ref("local-1"),
      turnRuntimeRegistry: ref(createTurnRuntimeRegistryState()),
      userId: ref("user-1"),
      chatWebSocketClient,
      reconnectReplay: {},
      chatList: {},
      resolveActiveSessionIdentity: () => "local-1",
      resolveActiveTurnScopeIdentity: () => "",
    });

    await expect(coordinator.handleReconnect()).resolves.toBe(false);
    expect(chatWebSocketClient.reconnect).not.toHaveBeenCalled();
  });

  it("finishes the ordered replay queue after a packet rejection", async () => {
    const replayOrder = [];
    const reconnectReplay = {
      applyReconnectData: vi.fn(async () => {
        replayOrder.push("snapshot");
        return { applied: true };
      }),
      applyReconnectEvent: vi.fn(async (event) => {
        replayOrder.push(event);
        if (event === "channel_state") throw new TypeError("projection failed");
        return { applied: true };
      }),
    };
    const chatWebSocketClient = {
      reconnect: vi.fn(async ({ onReconnectData }) => {
        onReconnectData({
          event: "channel_state",
          data: { sessionId: "s-1", turnScopeId: "turn-1", state: "interaction_pending" },
        });
        onReconnectData({ sessions: [{ sessionId: "s-1" }] });
      }),
    };
    const notify = vi.fn();
    const logSessionSystemEvent = vi.fn();
    const coordinator = createReconnectCoordinator({
      activeSession: ref({ sessionId: "s-1", messages: [] }),
      activeSessionId: ref("s-1"),
      turnRuntimeRegistry: ref(createTurnRuntimeRegistryState()),
      userId: ref("user-1"),
      chatWebSocketClient,
      reconnectReplay,
      chatList: {},
      classifyRealtimeLog: (entry) => entry,
      resolveActiveSessionIdentity: () => "s-1",
      resolveActiveTurnScopeIdentity: () => "",
      logSessionSystemEvent,
      notify,
      translate: (key) => key,
    });

    await coordinator.handleReconnect();

    expect(replayOrder).toEqual(["channel_state", "snapshot"]);
    expect(logSessionSystemEvent).toHaveBeenCalledWith("reconnect.failed", {
      error: "projection failed",
    });
    expect(notify).toHaveBeenCalledWith({ type: "warning", message: "infra.reconnectFailed" });
  });
});
