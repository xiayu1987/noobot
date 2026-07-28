/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createHarness, activateRuntimeTurn } from "./helpers/useChatEngineHarness.js";
import { BackendChannelState, FrontendRunState } from "../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import { RoleEnum } from "../../../../src/modules/chat/model/chatConstants.js";
import {
  applyExecutionSnapshot,
  resolveSessionTurnRuntime,
} from "../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";

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
      commandId: "stop:turn-stop-payload",
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
    expect(resolveSessionTurnRuntime(
      turnRuntimeRegistry.value,
      "backend-stop-payload",
      "turn-stop-payload",
    )).toMatchObject({
      action: "stop",
      commandId: "stop:turn-stop-payload",
      actionCommandId: "stop:turn-stop-payload",
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
        commandId: "stop:turn-refreshed",
        sessionId: "backend-stop-refreshed",
        dialogProcessId: "dp-refreshed",
        turnScopeId: "turn-refreshed",
        partialAssistant: expect.objectContaining({
          content: "partial after refresh",
          dialogProcessId: "dp-refreshed",
          turnScopeId: "turn-refreshed",
        }),
      }),
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
        commandId: "stop:turn-channel-identity",
        sessionId: "backend-stop-channel-identity",
        dialogProcessId: "dp-channel-identity",
        turnScopeId: "turn-channel-identity",
        partialAssistant: expect.objectContaining({
          content: "",
          dialogProcessId: "dp-channel-identity",
          turnScopeId: "turn-channel-identity",
        }),
      }),
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
        commandId: "stop:turn-user-fallback",
        sessionId: "backend-stop-user-turn-fallback",
        dialogProcessId: "dp-user-turn-fallback",
        turnScopeId: "turn-user-fallback",
        partialAssistant: expect.objectContaining({
          dialogProcessId: "dp-user-turn-fallback",
          turnScopeId: "turn-user-fallback",
        }),
      }),
    );
    expect(activeSession.value.messages[0]).not.toMatchObject({
      stopState: "user_stopped",
      monotonicState: "monotonic",
    });
  });

  it("stopSending targets a child Agent by executionId with authoritative identity and revision", () => {
    const { engine, deps, turnRuntimeRegistry } = createHarness({ sessionId: "main-session" });
    applyExecutionSnapshot(turnRuntimeRegistry.value, {
      executionId: "child-execution",
      executionKind: "agent",
      parentExecutionId: "workflow-execution",
      rootExecutionId: "workflow-execution",
      sessionId: "child-session",
      parentSessionId: "main-session",
      dialogProcessId: "child-dialog",
      turnScopeId: "child-turn",
      state: "processing",
      terminal: false,
      revision: 7,
      sequence: 9,
      capabilities: { canStop: true },
    });
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    expect(engine.stopSending("child-execution")).toBe(true);
    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: "stop:child-turn",
        executionId: "child-execution",
        expectedRevision: 7,
        sessionId: "child-session",
        parentSessionId: "main-session",
        dialogProcessId: "child-dialog",
        turnScopeId: "child-turn",
      }),
    );
  });

  it("stopSending rejects unknown, terminal, and non-stoppable executions", () => {
    const { engine, deps, turnRuntimeRegistry } = createHarness({ sessionId: "main-session" });
    const add = (executionId, overrides = {}) => applyExecutionSnapshot(turnRuntimeRegistry.value, {
      executionId,
      executionKind: "agent",
      rootExecutionId: executionId,
      sessionId: `${executionId}-session`,
      turnScopeId: `${executionId}-turn`,
      state: "processing",
      terminal: false,
      revision: 1,
      sequence: 1,
      capabilities: { canStop: true },
      ...overrides,
    });
    add("terminal-execution", { state: "completed", terminal: true });
    add("locked-execution", { capabilities: { canStop: false } });

    expect(engine.stopSending("missing-execution")).toBe(false);
    expect(engine.stopSending("terminal-execution")).toBe(false);
    expect(engine.stopSending("locked-execution")).toBe(false);
    expect(deps.chatWebSocketClient.requestStop).not.toHaveBeenCalled();
  });
});
