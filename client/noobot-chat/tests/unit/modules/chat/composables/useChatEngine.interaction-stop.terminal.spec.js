/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createHarness, assistantMessage, emitChannelState } from "../helpers/useChatEngineHarness.js";
import { StreamEventEnum, RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import { FrontendRunState } from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import { createSessionListActions } from "../../../../../src/modules/session/model/list/sessionListActions.js";
import {
  applyTurnRuntimeEvent,
  applyTurnLifecycleSnapshot,
  selectSessionTurnRuntime,
} from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { SESSION_RUN_EVENT } from "../../../../../src/modules/chat/runtime/run-state-machine/constants.js";
import { SESSION_DETAIL_APPLY_MODE } from "../../../../../src/modules/chat/runtime/engine/messageStateGuards.js";

describe("useChatEngine.interaction-stop: terminal", () => {
  it("applies the real refresh terminal payload atomically when discovery races snapshot hydration", async () => {
    const sessionId = "3801ff60-0a8d-4dd8-903f-139febe37254";
    const turnScopeId = "client-turn:mryihoqc:3qrncu3i";
    const terminalTurn = {
      executionId: `agent:${turnScopeId}`,
      executionKind: "agent",
      sessionId,
      turnScopeId,
      messageId: `msg-event-${turnScopeId}`,
      presentationMessageId: `msg-${turnScopeId}`,
      dialogProcessId: "a31a2316-61b9-452b-af1d-4be302fc375d",
      commandId: `${turnScopeId}:completed`,
      action: "send",
      state: "completed",
      phase: "completion",
      executionState: "sending",
      revision: 4,
      sequence: 4,
      summaryVersion: 0,
      completionCommitId: `${turnScopeId}:completed`,
      terminalStatus: { turnScopeId, status: "completed", reason: "run_completed" },
      failure: null,
      finalizeIntent: null,
      capabilities: { actionLocked: false, canStop: false },
    };
    let releaseResponse;
    const terminalResolutionFetcher = vi.fn(async () => ({
      ok: true,
      json: async () => new Promise((resolve) => { releaseResponse = resolve; }),
    }));
    const { engine, turnRuntimeRegistry, sessions } = createHarness({
      sessionId,
      deps: { terminalResolutionFetcher },
    });

    const first = engine.resolveTurnTerminalState(sessionId, turnScopeId, terminalTurn);
    await vi.waitFor(() => expect(releaseResponse).toBeTypeOf("function"));
    expect(applyTurnLifecycleSnapshot(turnRuntimeRegistry.value, {
      protocolVersion: 4,
      eventType: "turn.snapshot",
      commandId: "snapshot-refresh",
      userId: "u-1",
      sessionId,
      sequence: 4,
      activeTurnScopeId: "",
      activeTurn: null,
      recentTerminalTurns: [terminalTurn],
      replacedTurns: [],
      unchanged: false,
    }).applied).toBe(true);
    turnRuntimeRegistry.value = { ...turnRuntimeRegistry.value };
    releaseResponse({
      ok: true,
      protocolVersion: 1,
      eventType: "turn.terminal_resolved",
      commandId: "terminal-resolution:real:1",
      sessionId,
      turnScopeId,
      resolved: true,
      retryable: false,
      reason: "",
      retryAfterMs: 0,
      turn: terminalTurn,
      materialization: null,
    });
    await expect(first).resolves.toMatchObject({ applied: true });

    const second = await engine.resolveTurnTerminalState(sessionId, turnScopeId, terminalTurn);
    expect(second).toMatchObject({ applied: true });
    expect(terminalResolutionFetcher).toHaveBeenCalledTimes(1);
    expect(sessions.value[0]).toMatchObject({ backendSessionId: sessionId });
    expect(selectSessionTurnRuntime(turnRuntimeRegistry.value, sessionId, turnScopeId)).toMatchObject({
      terminal: "completed",
      sending: false,
      canStop: false,
    });
  });

  it("commits backend terminal identity without promoting the optimistic Session", async () => {
    const localSessionId = "local-refresh-session";
    const backendSessionId = "3801ff60-0a8d-4dd8-903f-139febe37254";
    const turnScopeId = "client-turn:mryihoqc:3qrncu3i";
    const terminalResolutionFetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        protocolVersion: 1,
        eventType: "turn.terminal_resolved",
        commandId: "terminal-resolution:identity-promotion",
        sessionId: backendSessionId,
        turnScopeId,
        resolved: true,
        retryable: false,
        turn: {
          sessionId: backendSessionId,
          turnScopeId,
          state: "completed",
          revision: 4,
          sequence: 4,
          completionCommitId: `${turnScopeId}:completed`,
          terminalStatus: { turnScopeId, status: "completed", reason: "run_completed" },
          capabilities: { actionLocked: false, canStop: false },
        },
        materialization: null,
      }),
    }));
    const { engine, activeSessionId, sessions, turnRuntimeRegistry } = createHarness({
      sessionId: localSessionId,
      deps: { terminalResolutionFetcher },
    });
    sessions.value[0].isLocal = true;
    sessions.value[0].messages = [{ turnScopeId }];

    const result = await engine.resolveTurnTerminalState(backendSessionId, turnScopeId, {
      revision: 4,
      sequence: 4,
    });

    expect(result).toMatchObject({ applied: true });
    expect(activeSessionId.value).toBe(localSessionId);
    expect(sessions.value[0]).toMatchObject({
      id: localSessionId,
      backendSessionId: localSessionId,
      isLocal: true,
    });
    expect(selectSessionTurnRuntime(turnRuntimeRegistry.value, backendSessionId, turnScopeId)).toMatchObject({
      terminal: "completed",
      sending: false,
      canStop: false,
    });
  });

  it("reconciles an optimistic Session before committing one authoritative terminal response", async () => {
    const localSessionId = "local-refresh-e2e";
    const backendSessionId = "backend-refresh-e2e";
    const turnScopeId = "client-turn:refresh-e2e";
    const terminalResolutionFetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        protocolVersion: 1,
        eventType: "turn.terminal_resolved",
        commandId: "terminal-resolution:refresh-e2e",
        sessionId: backendSessionId,
        turnScopeId,
        resolved: true,
        retryable: false,
        turn: {
          sessionId: backendSessionId,
          turnScopeId,
          state: "completed",
          revision: 2,
          sequence: 2,
          completionCommitId: `${turnScopeId}:completed`,
          terminalStatus: { turnScopeId, status: "completed", reason: "run_completed" },
          capabilities: { actionLocked: false, canStop: false },
        },
        materialization: null,
      }),
    }));
    const harness = createHarness({
      sessionId: localSessionId,
      deps: { terminalResolutionFetcher },
    });
    harness.sessions.value[0].isLocal = true;
    harness.sessions.value[0].messages = [{ role: RoleEnum.ASSISTANT, turnScopeId, pending: true }];
    applyTurnRuntimeEvent(harness.turnRuntimeRegistry.value, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: localSessionId,
      turnScopeId,
      dialogProcessId: "dp-refresh-e2e",
      source: "test",
    });
    harness.turnRuntimeRegistry.value = { ...harness.turnRuntimeRegistry.value };

    const listActions = createSessionListActions({
      sessions: harness.sessions,
      activeSessionId: harness.activeSessionId,
      loadingSessions: { value: false },
      loadingSessionDetail: { value: false },
      turnRuntimeRegistry: harness.turnRuntimeRegistry,
      userId: { value: "u-1" },
      authFetch: vi.fn(),
      ensureConnected: vi.fn(() => true),
      getSessionsApi: vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          sessions: [{
            sessionId: backendSessionId,
            id: backendSessionId,
            caller: RoleEnum.USER,
            updatedAt: "2026-07-24T05:42:15.485Z",
            turnLifecycleSnapshot: {
              activeTurn: null,
              recentTerminalTurns: [{ turnScopeId, state: "completed", revision: 2, sequence: 2 }],
            },
          }],
        }),
      })),
      deleteSessionApi: vi.fn(),
      renameSessionApi: vi.fn(),
      createConnectorPanelState: vi.fn(() => ({})),
      sessionTitleFromMessages: vi.fn(() => "refresh e2e"),
      fetchSessionDetail: vi.fn(async () => null),
      applySessionDetail: vi.fn(),
      createLocalSession: vi.fn(),
      refreshSessionConnectorsAsync: vi.fn(),
      translate: (key) => key,
      notify: vi.fn(),
    });

    await expect(listActions.fetchSessions(localSessionId, { silent: true })).resolves.toBe(true);
    expect(harness.activeSessionId.value).toBe(backendSessionId);
    expect(harness.turnRuntimeRegistry.value.sessionAliases[localSessionId]).toBe(backendSessionId);

    const resolution = await harness.engine.resolveTurnTerminalState(backendSessionId, turnScopeId, {
      revision: 2,
      sequence: 2,
    });

    expect(resolution).toMatchObject({ applied: true });
    expect(terminalResolutionFetcher).toHaveBeenCalledTimes(1);
    expect(harness.turnRuntimeRegistry.value.sessions[backendSessionId]?.turns?.[turnScopeId]).toMatchObject({
      terminalResolved: true,
    });
    expect(selectSessionTurnRuntime(
      harness.turnRuntimeRegistry.value,
      backendSessionId,
      turnScopeId,
    )).toMatchObject({
      terminal: "completed",
      sending: false,
      canStop: false,
    });
  });

  it("channel_state stopping/reconnecting/user_stopped remains a notification until terminal resolution", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-flight", "dp-flight", "stopping");
      emitChannelState(onEvent, "local-flight", "dp-flight", "reconnecting");
      emitChannelState(onEvent, "local-flight", "dp-flight", "user_stopped");
      onEvent({
        event: StreamEventEnum.USER_STOPPED,
        data: { sessionId: "local-flight", dialogProcessId: "dp-flight" },
      });
    });
    const { engine, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "local-flight",
      stream,
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(assistant?.statusLabel).toBe("");
    expect(assistant?.pending).toBe(false);
    expect(selectSessionTurnRuntime(turnRuntimeRegistry.value, "local-flight").sending).toBe(true);
  });

  it("channel_state stopping remains a message-level fact and does not replace the global action lock", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-stopping", "dp-stopping", "stopping");
    });
    const { engine, turnRuntimeRegistry } = createHarness({
      sessionId: "local-stopping",
      stream,
    });

    await engine.send();

    expect(selectSessionTurnRuntime(turnRuntimeRegistry.value, "local-stopping")).toMatchObject({
      sending: true,
      canStop: false,
    });
  });

  it("channel_state completed/error/no_conversation cannot overwrite terminal presentation", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-terminal", "dp-terminal", "completed");
      emitChannelState(onEvent, "local-terminal", "dp-terminal", "error");
      emitChannelState(onEvent, "local-terminal", "dp-terminal", "no_conversation");
    });
    const { engine, activeSession, sending, canStop, interactionSubmitting, deps } = createHarness({
      sessionId: "local-terminal",
      stream,
      pendingInteraction: {
        requestId: "req-terminal",
        sessionId: "local-terminal",
        dialogProcessId: "dp-terminal",
      },
      interactionSubmittingValue: true,
      deps: {
        clearPendingInteractionIfObsolete: vi.fn(() => true),
      },
    });

    await engine.send();

    const assistant = assistantMessage(activeSession);
    expect(assistant?.statusLabel).not.toBe("chat.generated");
    expect(assistant?.pending).toBe(false);
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(false);
    expect(interactionSubmitting.value).toBe(false);
    expect(deps.clearPendingInteraction).toHaveBeenCalled();
  });

  it("does not project a backend terminal onto an unreconciled local Session", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "backend-x", "dp-x", "completed", { seq: 2 });
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "backend-x",
          dialogProcessId: "dp-x",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-x", content: "ok" },
          ],
        },
      });
    });
    const { engine, activeSession, sending, canStop, deps } = createHarness({
      sessionId: "local-x",
      stream,
      deps: {
        fetchSessionDetail: vi.fn(async () => {
          throw new Error("ignore");
        }),
      },
    });

    await engine.send();

    expect(deps.terminalResolutionFetcher).toHaveBeenCalledTimes(0);
    expect(sending.value).toBe(true);
    const assistant = assistantMessage(activeSession);
    expect(assistant?.pending).toBe(false);
    expect(assistant?.channelState?.state).not.toBe(FrontendRunState.FRONTEND_COMPLETED);
    expect(assistant?.statusLabelKey || assistant?.statusLabel).not.toBe("chat.generated");
  });

  it("terminal channel_state without an Authority event does not converge the Turn", async () => {
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-state-only",
      sessions: [
        {
          sessionId: "local-state-only",
          messages: [
            { role: RoleEnum.USER, content: "hello" },
            {
              role: RoleEnum.ASSISTANT,
              dialogProcessId: "dp-state-only",
              content: "detail answer",
            },
          ],
        },
      ],
    }));
    const applySessionDetail = vi.fn(async () => {
      const assistant = assistantMessage(activeSession);
      assistant.content = "detail answer";
    });
    const stream = vi.fn(async (_payload, onEvent) => {
      emitChannelState(onEvent, "local-state-only", "dp-state-only", "completed", {
        seq: 2,
      });
    });
    const { engine, activeSession, sending, deps } = createHarness({
      sessionId: "local-state-only",
      stream,
      deps: {
        fetchSessionDetail,
        applySessionDetail,
      },
    });

    await expect(engine.send()).resolves.toBe(true);

    const assistant = assistantMessage(activeSession);
    expect(sending.value).toBe(true);
    expect(assistant?.content).not.toBe("detail answer");
    expect(fetchSessionDetail).not.toHaveBeenCalled();
    expect(applySessionDetail).not.toHaveBeenCalled();
  });

  it("consumes stream ERROR as data-plane content without resolving the Turn", async () => {
    const errorData = {
      error: "invalid tool input",
      sessionId: "s-error",
      dialogProcessId: "dp-error",
    };
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({ event: StreamEventEnum.ERROR, data: errorData });
      const error = new Error(errorData.error);
      error.data = errorData;
      throw error;
    });
    const fetchSessionDetail = vi.fn(async (sessionId) => ({ sessionId, messages: [] }));
    const applySessionDetail = vi.fn();
    const { engine, activeSession, sending, deps } = createHarness({
      sessionId: "s-error",
      stream,
      deps: { fetchSessionDetail, applySessionDetail },
    });

    await expect(engine.send()).resolves.toBe(false);

    const botMessage = assistantMessage(activeSession);
    expect(botMessage.dialogProcessId).not.toBe("dp-error");
    expect(botMessage.pending).toBe(false);
    expect(botMessage.error).toBe("invalid tool input");
    expect(fetchSessionDetail).not.toHaveBeenCalled();
    expect(applySessionDetail).not.toHaveBeenCalled();
    expect(deps.clearPendingInteraction).toHaveBeenCalled();
    expect(sending.value).toBe(true);
  });
});
