/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { applyReconnectEventReplay } from "../../../../src/composables/chat/reconnectReplay/reconnectEventReplay";
import { StreamEventEnum } from "../../../../src/shared/constants/chatConstants";

describe("applyReconnectEventReplay", () => {
  it.each([
    "workflow_planning_message_prepared",
    "workflow_node_state_committed",
  ])("routes %s directly to workflow runtime projection after reconnect", async (event) => {
    const data = {
      sessionId: "s-1",
      dialogProcessId: "dp-1",
      turnScopeId: "turn-1",
      workflowRunId: "workflow-1",
      nodeSessions: [{ nodeExecutionId: "node-1" }],
    };
    const applyWorkflowRuntimeEvent = vi.fn(() => ({ applied: true }));
    const applyReconnectMessagesToActiveSession = vi.fn();

    const result = await applyReconnectEventReplay({
      event,
      data,
      replayCache: {},
      isCurrentActiveSession: vi.fn(() => true),
      consumeReplayCacheForSession: vi.fn(),
      applyReconnectMessagesToActiveSession,
      applyChannelState: vi.fn(),
      applyWorkflowRuntimeEvent,
    });

    expect(result).toEqual({ applied: true });
    expect(applyWorkflowRuntimeEvent).toHaveBeenCalledWith(event, data);
    expect(applyReconnectMessagesToActiveSession).not.toHaveBeenCalled();
  });

  it("routes authoritative TURN_LIFECYCLE envelopes directly to the lifecycle reducer", async () => {
    const replayCache = {};
    const applyTurnLifecycleEnvelope = vi.fn(() => ({ applied: true }));
    const envelope = {
      eventType: "turn.processing_started",
      sessionId: "s-1",
      turnScopeId: "turn-1",
      revision: 2,
      sequence: 2,
    };

    const result = await applyReconnectEventReplay({
      event: StreamEventEnum.TURN_LIFECYCLE,
      data: envelope,
      replayCache,
      isCurrentActiveSession: vi.fn(() => false),
      consumeReplayCacheForSession: vi.fn(),
      applyReconnectMessagesToActiveSession: vi.fn(),
      applyChannelState: vi.fn(),
      applyTurnLifecycleEnvelope,
    });

    expect(result).toEqual({ applied: true });
    expect(applyTurnLifecycleEnvelope).toHaveBeenCalledOnce();
    expect(applyTurnLifecycleEnvelope).toHaveBeenCalledWith(envelope);
    expect(replayCache).toEqual({});
  });

  it("routes CHANNEL_STATE events without touching replay cache", async () => {
    const replayCache = {};
    const applyChannelState = vi.fn();
    const consumeReplayCacheForSession = vi.fn();
    const applyReconnectMessagesToActiveSession = vi.fn();

    await applyReconnectEventReplay({
      event: StreamEventEnum.CHANNEL_STATE,
      data: { state: "connected" },
      replayCache,
      isCurrentActiveSession: vi.fn(() => true),
      consumeReplayCacheForSession,
      applyReconnectMessagesToActiveSession,
      applyChannelState,
    });

    expect(applyChannelState).toHaveBeenCalledWith({ state: "connected" });
    expect(consumeReplayCacheForSession).not.toHaveBeenCalled();
    expect(applyReconnectMessagesToActiveSession).not.toHaveBeenCalled();
    expect(replayCache).toEqual({});
  });

  it("applies active session events after consuming cached replay", async () => {
    const replayCache = {};
    const consumeReplayCacheForSession = vi.fn(async () => {});
    const applyReconnectMessagesToActiveSession = vi.fn(async () => {});

    await applyReconnectEventReplay({
      event: "message",
      data: { sessionId: "s-1", dialogProcessId: "dp-1", content: "hello" },
      replayCache,
      isCurrentActiveSession: vi.fn((sessionId) => sessionId === "s-1"),
      consumeReplayCacheForSession,
      applyReconnectMessagesToActiveSession,
      applyChannelState: vi.fn(),
    });

    expect(consumeReplayCacheForSession).toHaveBeenCalledWith("s-1");
    expect(applyReconnectMessagesToActiveSession).toHaveBeenCalledWith(
      [{ event: "message", data: { sessionId: "s-1", dialogProcessId: "dp-1", content: "hello" } }],
      "dp-1",
      { turnScopeId: "" },
    );
    expect(replayCache).toEqual({});
  });

  it("caches non-active session events by normalized replay key", async () => {
    const replayCache = {};

    await applyReconnectEventReplay({
      event: "message",
      data: { sessionId: " s-2 ", dialogProcessId: " dp-2 ", content: "cached" },
      replayCache,
      isCurrentActiveSession: vi.fn(() => false),
      consumeReplayCacheForSession: vi.fn(),
      applyReconnectMessagesToActiveSession: vi.fn(),
      applyChannelState: vi.fn(),
    });

    expect(replayCache).toEqual({
      "s-2": {
        "dp-2": [
          {
            event: "message",
            data: { sessionId: " s-2 ", dialogProcessId: " dp-2 ", content: "cached" },
          },
        ],
      },
    });
  });

  it("applies active dialog process events even when live reconnect payload lacks sessionId", async () => {
    const replayCache = {};
    const consumeReplayCacheForSession = vi.fn(async () => {});
    const applyReconnectMessagesToActiveSession = vi.fn(async () => {});

    await applyReconnectEventReplay({
      event: StreamEventEnum.THINKING,
      data: { dialogProcessId: "dp-1", text: "tool running" },
      replayCache,
      isCurrentActiveSession: vi.fn(() => false),
      isCurrentActiveDialogProcess: vi.fn((dialogProcessId) => dialogProcessId === "dp-1"),
      consumeReplayCacheForSession,
      applyReconnectMessagesToActiveSession,
      applyChannelState: vi.fn(),
    });

    expect(consumeReplayCacheForSession).not.toHaveBeenCalled();
    expect(applyReconnectMessagesToActiveSession).toHaveBeenCalledWith(
      [{ event: StreamEventEnum.THINKING, data: { dialogProcessId: "dp-1", text: "tool running" } }],
      "dp-1",
      { turnScopeId: "" },
    );
    expect(replayCache).toEqual({});
  });

  it.each([
    [StreamEventEnum.DONE, { sessionId: "s-1", turnScopeId: "turn-1", dialogProcessId: "dp-1" }],
    [StreamEventEnum.CHANNEL_STATE, { sessionId: "s-1", turnScopeId: "turn-1", state: "completed" }],
    [StreamEventEnum.CHANNEL_STATE, { sessionId: "s-1", turnScopeId: "turn-1", state: "error" }],
    [StreamEventEnum.CHANNEL_STATE, { sessionId: "s-1", turnScopeId: "turn-1", state: "user_stopped" }],
  ])("does not grant terminal lifecycle authority without an exact currentRun: %s", async (event, data) => {
    const applyChannelState = vi.fn();
    await applyReconnectEventReplay({
      event,
      data,
      replayCache: {},
      isCurrentActiveSession: vi.fn(() => true),
      consumeReplayCacheForSession: vi.fn(),
      applyReconnectMessagesToActiveSession: vi.fn(),
      applyChannelState,
      hasAuthoritativeCurrentRun: vi.fn(() => false),
    });

    expect(applyChannelState).toHaveBeenCalledOnce();
    expect(applyChannelState.mock.calls[0][0]).toMatchObject({ authoritativeSnapshot: false });
  });

  it("grants terminal authority only for an exact session and Turn match", async () => {
    const applyChannelState = vi.fn();
    const hasAuthoritativeCurrentRun = vi.fn(({ sessionId, turnScopeId }) => (
      sessionId === "s-1" && turnScopeId === "turn-current"
    ));
    await applyReconnectEventReplay({
      event: StreamEventEnum.DONE,
      data: { sessionId: "s-1", turnScopeId: "turn-other", dialogProcessId: "shared-dialog" },
      replayCache: {},
      isCurrentActiveSession: vi.fn(() => true),
      consumeReplayCacheForSession: vi.fn(),
      applyReconnectMessagesToActiveSession: vi.fn(),
      applyChannelState,
      hasAuthoritativeCurrentRun,
    });
    await applyReconnectEventReplay({
      event: StreamEventEnum.DONE,
      data: { sessionId: "s-1", turnScopeId: "turn-current", dialogProcessId: "shared-dialog" },
      replayCache: {},
      isCurrentActiveSession: vi.fn(() => true),
      consumeReplayCacheForSession: vi.fn(),
      applyReconnectMessagesToActiveSession: vi.fn(),
      applyChannelState,
      hasAuthoritativeCurrentRun,
    });

    expect(applyChannelState.mock.calls[0][0].authoritativeSnapshot).toBe(false);
    expect(applyChannelState.mock.calls[1][0].authoritativeSnapshot).toBe(true);
  });

  it("never grants lifecycle authority to dialog-only DONE payloads", async () => {
    const applyChannelState = vi.fn();
    await applyReconnectEventReplay({
      event: StreamEventEnum.DONE,
      data: { dialogProcessId: "dp-1" },
      replayCache: {},
      isCurrentActiveSession: vi.fn(() => false),
      isCurrentActiveDialogProcess: vi.fn(() => true),
      consumeReplayCacheForSession: vi.fn(),
      applyReconnectMessagesToActiveSession: vi.fn(),
      applyChannelState,
      hasAuthoritativeCurrentRun: vi.fn(() => true),
    });

    expect(applyChannelState).toHaveBeenCalledWith(expect.objectContaining({
      state: "completed",
      authoritativeSnapshot: false,
    }));
  });

});
