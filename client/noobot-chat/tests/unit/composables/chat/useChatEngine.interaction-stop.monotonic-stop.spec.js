/*
 * Copyright (c) 2026 xiayu
 * Contact: xxxxxxxxx+xxxxxxxxx@xxxxx.xxxxxxx.xxxxxx.xxx
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createHarness, activateRuntimeTurn } from "./helpers/useChatEngineHarness";
import { BackendChannelState, createInitialSessionRunState } from "../../../../src/composables/chat/sessionRunStateMachine";
import { RoleEnum } from "../../../../src/shared/constants/chatConstants";

describe("useChatEngine.interaction-stop: monotonic-stop", () => {
  it("prepareMonotonicMessageAction treats stop confirmation timeout as stop precondition failure", async () => {
    vi.useFakeTimers();
    const { engine, deps, sending, canStop, activeSession, runStateSnapshot, turnRuntimeRegistry } = createHarness({
      sessionId: "local-monotonic-stop",
      deps: {
        monotonicActionStopTimeoutMs: 500,
        monotonicActionStopPollIntervalMs: 10,
      },
    });
    activeSession.value.messages.push({
      role: RoleEnum.USER,
      content: "question",
      turnScopeId: "turn-stop",
    });
    activateRuntimeTurn({ turnRuntimeRegistry, sessionId: "local-monotonic-stop", turnScopeId: "turn-stop", dialogProcessId: "dp-stop" });
    activeSession.value.messages.push({
      role: RoleEnum.ASSISTANT,
      content: "partial",
      pending: true,
      dialogProcessId: "dp-stop",
      turnScopeId: "turn-stop",
      channelState: {
        state: BackendChannelState.SENDING,
        dialogProcessId: "dp-stop",
        turnScopeId: "turn-stop",
      },
    });
    sending.value = true;
    canStop.value = true;
    runStateSnapshot.value = createInitialSessionRunState();
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    const actionPromise = engine.prepareMonotonicMessageAction();
    const rejectionExpectation = expect(actionPromise).rejects.toThrow("chat.monotonicActionStopTimeout");
    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(510);
    await rejectionExpectation;
    // The stop precondition failed, but no authoritative turn terminal was
    // produced, so the original run remains active.
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(false);
    vi.useRealTimers();
  });

  it("ignores stale stop confirmation timeout for a previous turn", () => {
    const { engine, deps, activeSession, sending, canStop, turnRuntimeRegistry } = createHarness({
      sessionId: "local-stale-stop-timeout",
    });
    activeSession.value.messages = [
      { role: RoleEnum.USER, content: "old question", turnScopeId: "turn-old" },
      {
        role: RoleEnum.ASSISTANT,
        content: "continuing",
        pending: true,
        dialogProcessId: "dp-new",
        turnScopeId: "turn-new",
        channelState: {
          state: BackendChannelState.SENDING,
          dialogProcessId: "dp-new",
          turnScopeId: "turn-new",
        },
      },
    ];
    activateRuntimeTurn({ turnRuntimeRegistry, sessionId: "local-stale-stop-timeout", turnScopeId: "turn-new", dialogProcessId: "dp-new" });
    sending.value = true;
    canStop.value = true;
    deps.chatWebSocketClient.requestStop.mockImplementation((_payload, onStopConfirmationTimeout) => {
      onStopConfirmationTimeout({
        sessionId: "local-stale-stop-timeout",
        dialogProcessId: "dp-old",
        turnScopeId: "turn-old",
      });
      return true;
    });

    expect(engine.stopSending()).toBe(true);

    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(false);
    expect(activeSession.value.messages[1]).toMatchObject({
      pending: true,
      dialogProcessId: "dp-new",
      turnScopeId: "turn-new",
    });
    expect(deps.chatWebSocketClient.dispose).not.toHaveBeenCalled();
  });

  it("prepareMonotonicMessageAction warns and rejects when stop does not settle", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const { engine, deps, activeSession, sending, runStateSnapshot, turnRuntimeRegistry } = createHarness({
      sessionId: "local-monotonic-timeout",
      deps: {
        notify,
        monotonicActionStopTimeoutMs: 30,
        monotonicActionStopPollIntervalMs: 10,
      },
    });
    activeSession.value.messages = [
      { role: RoleEnum.USER, content: "running", turnScopeId: "turn-timeout" },
      {
        role: RoleEnum.ASSISTANT,
        content: "",
        pending: true,
        turnScopeId: "turn-timeout",
        channelState: { state: "sending", turnScopeId: "turn-timeout" },
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];
    sending.value = true;
    runStateSnapshot.value = {
      state: BackendChannelState.SENDING,
      sessionId: "local-monotonic-timeout",
      turnScopeId: "turn-timeout",
    };
    activateRuntimeTurn({
      turnRuntimeRegistry,
      sessionId: "local-monotonic-timeout",
      turnScopeId: "turn-timeout",
    });
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    const actionPromise = engine.prepareMonotonicMessageAction();
    const rejectionExpectation = expect(actionPromise).rejects.toThrow(
      "chat.monotonicActionStopTimeout",
    );
    await vi.advanceTimersByTimeAsync(40);

    await rejectionExpectation;
    expect(notify).toHaveBeenCalledWith({
      type: "warning",
      message: "chat.monotonicActionStopTimeout",
    });
    expect(sending.value).toBe(true);
    vi.useRealTimers();
  });
});
