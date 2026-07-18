/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createHarness, activateRuntimeTurn } from "./helpers/useChatEngineHarness";
import { BackendChannelState, FrontendRunState } from "../../../../src/composables/chat/sessionRunStateMachine";
import { RoleEnum } from "../../../../src/shared/constants/chatConstants";

describe("useChatEngine.interaction-stop: stop-request", () => {
  it("send enables stop while stream is active", async () => {
    let releaseStream;
    const stream = vi.fn(() => new Promise((resolve) => {
      releaseStream = resolve;
    }));
    const { engine, sending, canStop } = createHarness({
      sessionId: "local-active-stop",
      stream,
    });

    const sendPromise = engine.send();
    await Promise.resolve();

    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);

    releaseStream();
    await sendPromise;
  });

  it("stopSending disables repeated stop and sends stable channel identity payload", async () => {
    const { engine, deps, sending, canStop, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "local-stop-payload",
    });
    activeSession.value.backendSessionId = "backend-stop-payload";
    activeSession.value.parentSessionId = "parent-session";
    activateRuntimeTurn({ turnRuntimeRegistry, sessionId: "backend-stop-payload", turnScopeId: "turn-stop-payload", dialogProcessId: "dp-stop-payload" });
    activeSession.value.messages.push({
      role: RoleEnum.ASSISTANT,
      content: "partial answer",
      pending: true,
      dialogProcessId: "dp-stop-payload",
      turnScopeId: "turn-stop-payload",
      parentDialogProcessId: "parent-dp",
      modelAlias: "alias-a",
      modelName: "model-a",
    });
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    expect(engine.stopSending()).toBe(true);
    expect(canStop.value).toBe(false);
    expect(engine.stopSending()).toBe(false);
    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledTimes(1);
    expect(deps.chatWebSocketClient.requestStop.mock.calls[0][0]).toMatchObject({
      userId: "u-1",
      sessionId: "backend-stop-payload",
      dialogProcessId: "dp-stop-payload",
      turnScopeId: "turn-stop-payload",
      parentSessionId: "parent-session",
      parentDialogProcessId: "parent-dp",
      partialAssistant: {
        content: "partial answer",
        dialogProcessId: "dp-stop-payload",
        turnScopeId: "turn-stop-payload",
        modelAlias: "alias-a",
        modelName: "model-a",
      },
    });
  });

  it("stopSending can stop a refreshed in-flight assistant with channelState but no pending flag", async () => {
    const { engine, deps, sending, canStop, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "local-stop-refreshed",
    });
    activeSession.value.backendSessionId = "backend-stop-refreshed";
    activateRuntimeTurn({ turnRuntimeRegistry, sessionId: "backend-stop-refreshed", turnScopeId: "turn-refreshed", dialogProcessId: "dp-refreshed" });
    activeSession.value.messages = [
      { role: RoleEnum.USER, content: "edited", turnScopeId: "turn-refreshed" },
      {
        role: RoleEnum.ASSISTANT,
        content: "partial after refresh",
        dialogProcessId: "dp-refreshed",
        turnScopeId: "turn-refreshed",
        channelState: { state: FrontendRunState.RESEND_STREAMING },
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    expect(engine.stopSending()).toBe(true);
    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "backend-stop-refreshed",
        dialogProcessId: "dp-refreshed",
        turnScopeId: "turn-refreshed",
        partialAssistant: expect.objectContaining({
          content: "partial after refresh",
          dialogProcessId: "dp-refreshed",
          turnScopeId: "turn-refreshed",
        }),
      }),
      expect.any(Function),
    );
  });

  it("stopSending uses Registry identity when the message has no direct turn identity", async () => {
    const { engine, deps, sending, canStop, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "local-stop-channel-identity",
    });
    activeSession.value.backendSessionId = "backend-stop-channel-identity";
    activateRuntimeTurn({ turnRuntimeRegistry, sessionId: "backend-stop-channel-identity", turnScopeId: "turn-channel-identity", dialogProcessId: "dp-channel-identity" });
    activeSession.value.messages = [
      { role: RoleEnum.USER, content: "running", turnScopeId: "turn-channel-identity" },
      {
        role: RoleEnum.ASSISTANT,
        content: "partial after refresh",
        channelState: {
          state: BackendChannelState.SENDING,
          dialogProcessId: "dp-channel-identity",
          turnScopeId: "turn-channel-identity",
        },
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    expect(engine.stopSending()).toBe(true);
    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "backend-stop-channel-identity",
        dialogProcessId: "dp-channel-identity",
        turnScopeId: "turn-channel-identity",
        partialAssistant: expect.objectContaining({
          content: "",
          dialogProcessId: "dp-channel-identity",
          turnScopeId: "turn-channel-identity",
        }),
      }),
      expect.any(Function),
    );
    expect(activeSession.value.messages[0]).not.toMatchObject({
      stopState: "user_stopped",
      monotonicState: "monotonic",
    });
  });

  it("stopSending can recover turnScopeId from the latest matching user message after refresh", async () => {
    const { engine, deps, sending, canStop, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "local-stop-user-turn-fallback",
    });
    activeSession.value.backendSessionId = "backend-stop-user-turn-fallback";
    activateRuntimeTurn({ turnRuntimeRegistry, sessionId: "backend-stop-user-turn-fallback", turnScopeId: "turn-user-fallback", dialogProcessId: "dp-user-turn-fallback" });
    activeSession.value.messages = [
      {
        role: RoleEnum.USER,
        content: "running",
        dialogProcessId: "dp-user-turn-fallback",
        turnScopeId: "turn-user-fallback",
      },
      {
        role: RoleEnum.ASSISTANT,
        content: "",
        pending: true,
        dialogProcessId: "dp-user-turn-fallback",
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    expect(engine.stopSending()).toBe(true);
    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "backend-stop-user-turn-fallback",
        dialogProcessId: "dp-user-turn-fallback",
        turnScopeId: "turn-user-fallback",
        partialAssistant: expect.objectContaining({
          dialogProcessId: "dp-user-turn-fallback",
          turnScopeId: "turn-user-fallback",
        }),
      }),
      expect.any(Function),
    );
    expect(activeSession.value.messages[0]).not.toMatchObject({
      stopState: "user_stopped",
      monotonicState: "monotonic",
    });
  });
});
