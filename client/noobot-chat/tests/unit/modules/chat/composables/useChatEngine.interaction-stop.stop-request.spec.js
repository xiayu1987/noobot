/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { deriveAgentExecutionId } from "@noobot/session-protocol/execution-lifecycle";
import { createHarness, activateRuntimeTurn } from "../helpers/useChatEngineHarness.js";
import {
  AGENT_CHANNEL_STATE,
  FrontendRunState,
} from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import { RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import {
  applyExecutionSnapshot,
  selectTurnRuntimeByScope,
} from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";

const CHILD_EXECUTION_ID = deriveAgentExecutionId({ turnScopeId: "child-turn" });

describe("useChatEngine.interaction-stop: stop-request", () => {
  it("send enables stop while stream is active", async () => {
    let releaseStream;
    const stream = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseStream = resolve;
        }),
    );
    const { engine, sending, canStop, activeTurnRuntime, turnRuntimeRegistry } = createHarness({
      sessionId: "local-active-stop",
      stream,
    });

    const sendPromise = engine.send();
    await Promise.resolve();

    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(false);

    activateRuntimeTurn({
      turnRuntimeRegistry,
      sessionId: "local-active-stop",
      turnScopeId: activeTurnRuntime.value.turnScopeId,
      dialogProcessId: "dp-local-active-stop",
    });
    expect(canStop.value).toBe(true);

    releaseStream();
    await sendPromise;
  });

  it("stopSending disables repeated stop and sends stable channel identity payload", async () => {
    const { engine, deps, canStop, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "backend-stop-payload",
    });
    activateRuntimeTurn({
      turnRuntimeRegistry,
      sessionId: "backend-stop-payload",
      parentSessionId: "parent-session",
      turnScopeId: "turn-stop-payload",
      dialogProcessId: "dp-stop-payload",
    });
    activeSession.value.messages.push({
      role: RoleEnum.ASSISTANT,
      content: "partial answer",
      pending: true,
      dialogProcessId: "dp-stop-payload",
      turnScopeId: "turn-stop-payload",
      modelAlias: "alias-a",
      modelName: "model-a",
    });
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    expect(engine.stopSending()).toBe(true);
    expect(canStop.value).toBe(false);
    expect(engine.stopSending()).toBe(false);
    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledTimes(1);
    expect(deps.chatWebSocketClient.requestStop.mock.calls[0][0]).toMatchObject({
      protocolVersion: 2,
      commandType: "turn.stop",
      commandId: "stop:turn-stop-payload",
      identity: {
        sessionId: "backend-stop-payload",
        dialogProcessId: "dp-stop-payload",
        turnScopeId: "turn-stop-payload",
        parentSessionId: "parent-session",
        parentDialogProcessId: "",
      },
      concurrency: { expectedTurnRevision: 2 },
      stop: {},
    });
    expect(
      selectTurnRuntimeByScope(
        turnRuntimeRegistry.value,
        "backend-stop-payload",
        "turn-stop-payload",
      ),
    ).toMatchObject({
      action: "stop",
      commandId: "stop:turn-stop-payload",
    });
  });

  it("stopSending can stop a refreshed in-flight assistant with channelState but no pending flag", async () => {
    const { engine, deps, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "backend-stop-refreshed",
    });
    activateRuntimeTurn({
      turnRuntimeRegistry,
      sessionId: "backend-stop-refreshed",
      turnScopeId: "turn-refreshed",
      dialogProcessId: "dp-refreshed",
    });
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
        identity: expect.objectContaining({
          sessionId: "backend-stop-refreshed",
          dialogProcessId: "dp-refreshed",
          turnScopeId: "turn-refreshed",
        }),
        stop: {},
      }),
    );
  });

  it("stopSending uses Registry identity when the message has no direct turn identity", async () => {
    const { engine, deps, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "backend-stop-channel-identity",
    });
    activateRuntimeTurn({
      turnRuntimeRegistry,
      sessionId: "backend-stop-channel-identity",
      turnScopeId: "turn-channel-identity",
      dialogProcessId: "dp-channel-identity",
    });
    activeSession.value.messages = [
      { role: RoleEnum.USER, content: "running", turnScopeId: "turn-channel-identity" },
      {
        role: RoleEnum.ASSISTANT,
        content: "partial after refresh",
        channelState: {
          state: AGENT_CHANNEL_STATE.SENDING,
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
        identity: expect.objectContaining({
          sessionId: "backend-stop-channel-identity",
          dialogProcessId: "dp-channel-identity",
          turnScopeId: "turn-channel-identity",
        }),
        stop: {},
      }),
    );
    expect(activeSession.value.messages[0]).not.toMatchObject({
      stopState: "user_stopped",
      monotonicState: "monotonic",
    });
  });

  it("stopSending can recover turnScopeId from the latest matching user message after refresh", async () => {
    const { engine, deps, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "backend-stop-user-turn-fallback",
    });
    activateRuntimeTurn({
      turnRuntimeRegistry,
      sessionId: "backend-stop-user-turn-fallback",
      turnScopeId: "turn-user-fallback",
      dialogProcessId: "dp-user-turn-fallback",
    });
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
        identity: expect.objectContaining({
          sessionId: "backend-stop-user-turn-fallback",
          dialogProcessId: "dp-user-turn-fallback",
          turnScopeId: "turn-user-fallback",
        }),
        stop: {},
      }),
    );
    expect(activeSession.value.messages[0]).not.toMatchObject({
      stopState: "user_stopped",
      monotonicState: "monotonic",
    });
  });

  it("stopExecution targets a child Agent by executionId with authoritative identity and revision", () => {
    const { engine, deps, turnRuntimeRegistry } = createHarness({ sessionId: "main-session" });
    applyExecutionSnapshot(turnRuntimeRegistry.value, {
      execution: {
        executionId: CHILD_EXECUTION_ID,
        executionKind: "agent",
        parentExecutionId: "workflow-execution",
        rootExecutionId: "workflow-execution",
        sessionId: "child-session",
        parentSessionId: "main-session",
        dialogProcessId: "child-dialog",
        turnScopeId: "child-turn",
        state: "processing",
        executionState: "sending",
        revision: 7,
        sequence: 9,
      },
    });
    deps.chatWebSocketClient.requestStop.mockReturnValue(true);

    expect(engine.stopExecution(CHILD_EXECUTION_ID)).toBe(true);
    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: "stop:child-turn",
        identity: expect.objectContaining({
          sessionId: "child-session",
          parentSessionId: "main-session",
          dialogProcessId: "child-dialog",
          turnScopeId: "child-turn",
        }),
        concurrency: { expectedTurnRevision: 7 },
        stop: expect.objectContaining({ executionId: CHILD_EXECUTION_ID }),
      }),
    );
  });

  it("stopExecution rejects unknown, terminal, and non-stoppable executions", () => {
    const { engine, deps, turnRuntimeRegistry } = createHarness({ sessionId: "main-session" });
    const add = (executionId, overrides = {}) =>
      applyExecutionSnapshot(turnRuntimeRegistry.value, {
        execution: {
          executionId,
          executionKind: "agent",
          rootExecutionId: executionId,
          sessionId: `${executionId}-session`,
          turnScopeId: `${executionId}-turn`,
          state: "processing",
          executionState: "sending",
          revision: 1,
          sequence: 1,
          ...overrides,
        },
      });
    add("terminal-execution", { state: "completed", executionState: "completed" });
    add("locked-execution", { executionState: "completed" });

    expect(engine.stopExecution("missing-execution")).toBe(false);
    expect(engine.stopExecution("terminal-execution")).toBe(false);
    expect(engine.stopExecution("locked-execution")).toBe(false);
    expect(deps.chatWebSocketClient.requestStop).not.toHaveBeenCalled();
  });
});
