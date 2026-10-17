/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createReconnectControl, createReconnectData } from "@noobot/agent-transport-protocol";
import { createExecutionQueryEnvelope } from "@noobot/event-protocol/execution-query";
import { deriveAgentExecutionId } from "@noobot/session-protocol/execution-lifecycle";
import { createReconnectCoordinator } from "../../../../../../src/modules/chat/runtime/session/reconnectCoordinator.js";
import { createTurnRuntimeRegistryState } from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { executionTurnKey } from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistryIdentity.js";
import { StreamEventEnum } from "../../../../../../src/modules/chat/model/chatConstants.js";

describe("createReconnectCoordinator", () => {
  it("does not reconnect a local Session without a backend identity", async () => {
    const chatWebSocketClient = { reconnect: vi.fn() };
    const coordinator = createReconnectCoordinator({
      activeSession: ref({ id: "local-1", sessionId: "", isLocal: true, messages: [] }),
      activeSessionId: ref("local-1"),
      turnRuntimeRegistry: ref(createTurnRuntimeRegistryState()),
      chatWebSocketClient,
      reconnectReplay: {},
      chatList: {},
      resolveActiveSessionIdentity: () => "local-1",
      resolveActiveTurnScopeIdentity: () => "",
    });

    await expect(coordinator.handleReconnect()).resolves.toBe(false);
    expect(chatWebSocketClient.reconnect).not.toHaveBeenCalled();
  });

  it("declares the active child session parent identity on reconnect", async () => {
    const chatWebSocketClient = { reconnect: vi.fn(async () => {}) };
    const coordinator = createReconnectCoordinator({
      activeSession: ref({
        sessionId: "child-1",
        parentSessionId: "parent-1",
        parentDialogProcessId: "parent-dp-1",
        messages: [],
      }),
      activeSessionId: ref("child-1"),
      turnRuntimeRegistry: ref(createTurnRuntimeRegistryState()),
      chatWebSocketClient,
      reconnectReplay: {},
      chatList: {},
      resolveActiveSessionIdentity: () => "child-1",
      resolveActiveTurnScopeIdentity: () => "",
      logSessionSystemEvent: vi.fn(),
      notify: vi.fn(),
      translate: (key) => key,
    });

    await coordinator.handleReconnect();

    const request = chatWebSocketClient.reconnect.mock.calls[0][0];
    expect(request).toMatchObject({
      identity: {
        sessionId: "child-1",
        parentSessionId: "parent-1",
        parentDialogProcessId: "parent-dp-1",
      },
    });
    expect("userId" in request).toBe(false);
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
        const control = createReconnectControl({
          requestId: "reconnect-s-1",
          identity: { sessionId: "s-1", parentSessionId: "", parentDialogProcessId: "" },
          knownLifecycleSequenceMap: {},
        });
        onReconnectData({
          event: StreamEventEnum.RECONNECT_DATA,
          data: createReconnectData(control, [{ sessionId: "s-1", replayBatch: {} }]),
        });
      }),
    };
    const notify = vi.fn();
    const logSessionSystemEvent = vi.fn();
    const coordinator = createReconnectCoordinator({
      activeSession: ref({ sessionId: "s-1", messages: [] }),
      activeSessionId: ref("s-1"),
      turnRuntimeRegistry: ref(createTurnRuntimeRegistryState()),
      chatWebSocketClient,
      reconnectReplay,
      chatList: {},
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

  it("does not replay a direct execution restore response delivered to the live subscriber", async () => {
    const registry = createTurnRuntimeRegistryState();
    registry.sessions["s-1"] = {
      activeTurnScopeId: "turn-1",
      turns: { "turn-1": { sessionId: "s-1", turnScopeId: "turn-1", state: "processing" } },
    };
    const executionId = deriveAgentExecutionId({ turnScopeId: "turn-1" });
    registry.executionIdByTurnScopeId[executionTurnKey("s-1", "turn-1")] = executionId;
    const execution = {
      executionId,
      executionKind: "agent",
      rootExecutionId: executionId,
      sessionId: "s-1",
      turnScopeId: "turn-1",
      revision: 1,
      sequence: 1,
      state: "processing",
    };
    let liveSubscriber = null;
    const reconnectReplay = {
      applyReconnectData: vi.fn(),
      applyReconnectEvent: vi.fn(async () => ({ applied: true })),
    };
    const responseFor = (command) =>
      command.commandType === "execution.tree.get"
        ? {
            event: StreamEventEnum.EXECUTION_TREE,
            payload: {
              rootExecutionId: executionId,
              tree: { executions: { [executionId]: execution } },
            },
          }
        : { event: StreamEventEnum.EXECUTION_SNAPSHOT, payload: { execution } };
    const chatWebSocketClient = {
      reconnect: vi.fn(async ({ onReconnectData }) => {
        liveSubscriber = onReconnectData;
      }),
      requestJson: vi.fn(async (command) => {
        const { event, payload } = responseFor(command);
        const data = createExecutionQueryEnvelope({
          wireEvent: event,
          commandId: command.commandId,
          executionId,
          payload,
          occurredAt: "2026-01-01T00:00:00.000Z",
        });
        liveSubscriber({ event, data });
        return { event, data };
      }),
    };
    const coordinator = createReconnectCoordinator({
      activeSession: ref({ sessionId: "s-1", messages: [] }),
      activeSessionId: ref("s-1"),
      turnRuntimeRegistry: ref(registry),
      chatWebSocketClient,
      reconnectReplay,
      chatList: {},
      resolveActiveSessionIdentity: () => "s-1",
      resolveActiveTurnScopeIdentity: () => "turn-1",
      logSessionSystemEvent: vi.fn(),
      notify: vi.fn(),
      translate: (key) => key,
    });

    await coordinator.handleReconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chatWebSocketClient.requestJson).toHaveBeenCalledTimes(2);
    expect(reconnectReplay.applyReconnectEvent.mock.calls.map(([event]) => event)).toEqual([
      StreamEventEnum.EXECUTION_TREE,
      StreamEventEnum.EXECUTION_SNAPSHOT,
    ]);
  });
});
