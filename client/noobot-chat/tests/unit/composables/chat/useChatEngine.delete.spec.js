/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  createHarness,
  activateRuntimeTurn,
  makeSession,
} from "./helpers/useChatEngineHarness";
import { BackendChannelState, FrontendRunState, SESSION_RUN_EVENT } from "../../../../src/composables/chat/sessionRunStateMachine";
import { SESSION_DETAIL_APPLY_MODE } from "../../../../src/composables/chat/chatEngine/messageStateGuards";
import { applyTurnRuntimeEvent, resolveSessionTurnRuntime } from "../../../../src/composables/chat/sessionRunStateMachine/turnRuntimeRegistry";
import {
  RoleEnum,
} from "../../../../src/shared/constants/chatConstants";

describe("useChatEngine.delete", () => {
  it("cascadeDeleteMessagesFrom resolves assistant target to user message and removes the user turn", () => {
    const { engine, activeSession } = createHarness({ sessionId: "local-cascade" });
    const first = { turnScopeId: "scope-old", dialogProcessId: "dp-old", role: RoleEnum.USER, content: "first" };
    const target = { turnScopeId: "scope-old", dialogProcessId: "dp-old", role: RoleEnum.ASSISTANT, content: "target" };
    const tail = { id: "m3", role: RoleEnum.USER, content: "tail" };
    activeSession.value.messages = [first, target, tail];
    activeSession.value.rawMessages = [first, target, tail];
    activeSession.value.messageCount = 3;
    activeSession.value.lastMessage = tail;

    expect(engine.cascadeDeleteMessagesFrom(target)).toBe(true);

    expect(activeSession.value.messages).toEqual([]);
    expect(activeSession.value.messageCount).toBe(0);
    expect(activeSession.value.lastMessage).toBe(null);
    expect(activeSession.value.updatedAt).toBeTruthy();
  });

  it("cascadeDeleteMessagesFrom removes matching rawMessages even when they are not the same objects", () => {
    const { engine, activeSession } = createHarness({ sessionId: "local-cascade-raw-copy" });
    const first = { id: "m1", role: RoleEnum.USER, content: "first", turnScopeId: "turn-1", dialogProcessId: "dp-1" };
    const target = { id: "m2", role: RoleEnum.ASSISTANT, content: "target", turnScopeId: "turn-1", dialogProcessId: "dp-1" };
    const tail = { id: "m3", role: RoleEnum.USER, content: "tail", turnScopeId: "turn-2", dialogProcessId: "dp-2" };
    activeSession.value.messages = [first, target, tail];
    activeSession.value.rawMessages = [
      { ...first },
      { ...target },
      { ...tail },
    ];
    activeSession.value.messageCount = 3;
    activeSession.value.lastMessage = tail;

    expect(engine.cascadeDeleteMessagesFrom(target)).toBe(true);

    expect(activeSession.value.messages).toEqual([]);
    expect(activeSession.value.messageCount).toBe(0);
    expect(activeSession.value.lastMessage).toBe(null);
  });

  it("deleteMonotonicMessage waits for confirmed stop before cascading deletion from resolved user message", async () => {
    const { engine, activeSession, sending, canStop, deps, turnRuntimeRegistry } = createHarness({ sessionId: "local-delete" });
    const first = { id: "m1", turnScopeId: "client-turn:resend-stale", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", turnScopeId: "client-turn:resend-stale", role: RoleEnum.ASSISTANT, content: "target", pending: true };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activateRuntimeTurn({ turnRuntimeRegistry, sessionId: "local-delete", turnScopeId: target.turnScopeId });
    deps.chatWebSocketClient.requestStop.mockImplementation(() => {
      queueMicrotask(() => {
        target.stopState = "user_stopped";
        target.channelState = {
          state: BackendChannelState.USER_STOPPED,
          turnScopeId: target.turnScopeId,
          dialogProcessId: target.dialogProcessId,
        };
        applyTurnRuntimeEvent(turnRuntimeRegistry.value, {
          type: "local_user_stop_summary_applied",
          sessionId: "local-delete",
          turnScopeId: target.turnScopeId,
        });
      });
      return true;
    });

    await expect(engine.deleteMonotonicMessage(target)).resolves.toBe(true);

    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledTimes(1);
    expect(activeSession.value.messages).toEqual([]);
  });

  it("resendMonotonicMessage does not continue when stop confirmation is still pending", async () => {
    const stream = vi.fn(async () => {});
    const { engine, activeSession, deps, input, turnRuntimeRegistry } = createHarness({
      sessionId: "local-resend",
      stream,
    });
    const first = { id: "m1", turnScopeId: "client-turn:resend-no-flicker", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", turnScopeId: "client-turn:resend-no-flicker", role: RoleEnum.ASSISTANT, content: "target", pending: true };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activateRuntimeTurn({ turnRuntimeRegistry, sessionId: "local-resend", turnScopeId: target.turnScopeId });
    deps.chatWebSocketClient.requestStop.mockImplementation((_payload, onStopConfirmationTimeout) => {
      onStopConfirmationTimeout();
      return true;
    });

    await expect(engine.resendMonotonicMessage(target, "edited question"))
      .rejects.toThrow("chat.monotonicActionStopTimeout");

    expect(deps.chatWebSocketClient.requestStop).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
    expect(input.value).toBe("hello");
  });

  it("deleteMonotonicMessage resolves assistant turnScopeId to user anchor and applies backend snapshot", async () => {
    const backendSession = makeSession("local-delete-api", {
      messages: [{ id: "m1", role: RoleEnum.USER, content: "first" }],
      rawMessages: [{ id: "m1", role: RoleEnum.USER, content: "first" }],
      messageCount: 1,
      version: 3,
    });
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: backendSession,
      deletedCount: 2,
      anchorIndex: 1,
      version: 3,
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-delete-api",
      deps: { deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = { turnScopeId: "client-turn:delete-1", role: RoleEnum.USER, content: "first" };
    const target = { turnScopeId: "client-turn:delete-1", role: RoleEnum.ASSISTANT, content: "target" };
    const tail = { id: "m3", role: RoleEnum.USER, content: "tail" };
    activeSession.value.messages = [first, target, tail];
    activeSession.value.rawMessages = [first, target, tail];
    activeSession.value.version = 2;

    await expect(engine.deleteMonotonicMessage(target)).resolves.toBe(true);

    expect(deleteSessionMessagesFromApi).toHaveBeenCalledWith(expect.objectContaining({
      anchor: { turnScopeId: "client-turn:delete-1" },
      expectedVersion: 2,
    }), expect.any(Object));
    expect(applySessionDetail).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "local-delete-api",
      sessions: [expect.objectContaining({
        sessionId: "local-delete-api",
        messages: backendSession.messages,
      })],
    }), {
      mode: SESSION_DETAIL_APPLY_MODE.DELETE_CONFIRMED,
      preserveCurrentMessages: false,
    });
    expect(activeSession.value.messages).toHaveLength(1);
  });

  it("deleteMonotonicMessage immediately removes stopped pending tail even when detail preserve would keep it", async () => {
    const backendSession = makeSession("local-delete-stopped-tail", {
      messages: [],
      rawMessages: [],
      messageCount: 0,
      version: 4,
    });
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: backendSession,
      deletedCount: 2,
      anchorIndex: 0,
      version: 4,
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      const detailTurnScopeIds = new Set((mainSession.messages || []).map((message) => message.turnScopeId).filter(Boolean));
      const shouldPreserveStoppedTail = activeSession.value.messages.some((message) => (
        message.role === RoleEnum.ASSISTANT &&
        message.turnScopeId &&
        !detailTurnScopeIds.has(message.turnScopeId) &&
        (message.pending === true || message.channelState?.state === "stopping")
      ));
      if (shouldPreserveStoppedTail) return;
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-delete-stopped-tail",
      deps: { deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = { id: "u1", turnScopeId: "turn-stopped-tail", role: RoleEnum.USER, content: "first" };
    const target = {
      id: "a1",
      turnScopeId: "turn-stopped-tail",
      role: RoleEnum.ASSISTANT,
      content: "target",
      pending: true,
      channelState: { state: "stopping", turnScopeId: "turn-stopped-tail" },
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activeSession.value.version = 3;

    await expect(engine.deleteMonotonicMessage(target)).resolves.toBe(true);

    expect(deleteSessionMessagesFromApi).toHaveBeenCalledTimes(1);
    expect(applySessionDetail).toHaveBeenCalledWith(expect.any(Object), {
      mode: SESSION_DETAIL_APPLY_MODE.DELETE_CONFIRMED,
      preserveCurrentMessages: false,
    });
    expect(activeSession.value.messages).toEqual([]);
  });

  it("deleteMonotonicMessage does not locally delete when backend returns failure", async () => {
    const deleteSessionMessagesFromApi = vi.fn(async () => ({ ok: false, status: 409 }));
    const { engine, activeSession } = createHarness({
      sessionId: "local-delete-api-fail",
      deps: { deleteSessionMessagesFromApi },
    });
    const first = { id: "m1", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activeSession.value.version = 2;

    await expect(engine.deleteMonotonicMessage(target)).resolves.toBe(false);

    expect(activeSession.value.messages).toEqual([first, target]);
  });

  it("deleteMonotonicMessage deletes stopped turn when sending state is still stop-requested", async () => {
    const backendSession = makeSession("local-delete-stopped-sending", {
      messages: [],
      rawMessages: [],
      messageCount: 0,
      version: 8,
    });
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: backendSession,
      deletedCount: 2,
      anchorIndex: 0,
      version: 8,
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, sending, canStop, turnRuntimeRegistry, deps } = createHarness({
      sessionId: "local-delete-stopped-sending",
      deps: { deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = {
      id: "u1",
      turnScopeId: "turn-stopped-sending",
      dialogProcessId: "dp-stopped-sending",
      role: RoleEnum.USER,
      content: "first",
      stopState: "user_stopped",
      monotonicState: "monotonic",
      isMonotonic: true,
      monotonic: true,
    };
    const target = {
      id: "a1",
      turnScopeId: "turn-stopped-sending",
      dialogProcessId: "dp-stopped-sending",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      pending: true,
      channelState: { state: "stopping", turnScopeId: "turn-stopped-sending" },
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [{ ...first }, { ...target }];
    activeSession.value.version = 7;
    applyTurnRuntimeEvent(turnRuntimeRegistry.value, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
      sessionId: "local-delete-stopped-sending",
      turnScopeId: target.turnScopeId,
      dialogProcessId: target.dialogProcessId,
      source: "test",
    });

    await expect(engine.deleteMonotonicMessage(target, { timeoutMs: 20, pollIntervalMs: 5 })).resolves.toBe(true);

    expect(deps.chatWebSocketClient.requestStop).not.toHaveBeenCalled();
    // The registry is the sole runtime source. Deleting the stopped turn
    // removes its runtime entry, so the session projection becomes idle.
    expect(sending.value).toBe(false);
    expect(canStop.value).toBe(false);
    expect(resolveSessionTurnRuntime(turnRuntimeRegistry.value, "local-delete-stopped-sending"))
      .toBe(null);
    expect(deleteSessionMessagesFromApi).toHaveBeenCalledWith(expect.objectContaining({
      anchor: { turnScopeId: "turn-stopped-sending" },
      expectedVersion: 7,
    }), expect.any(Object));
    expect(activeSession.value.messages).toEqual([]);
  });

  it("resendMonotonicMessage does not send when backend delete fails", async () => {
    const stream = vi.fn(async () => {});
    const deleteSessionMessagesFromApi = vi.fn(async () => ({ ok: false, status: 404 }));
    const { engine, activeSession, input } = createHarness({
      sessionId: "local-resend-api-fail",
      stream,
      deps: { deleteSessionMessagesFromApi },
    });
    const first = { id: "m1", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    input.value = "draft before resend";

    await expect(engine.resendMonotonicMessage(target, "edited retry text")).resolves.toBe(false);

    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(input.value).toBe("draft before resend");
  });

  it("deleteMonotonicMessage does not delete when stop precondition fails", async () => {
    vi.useFakeTimers();
    const { engine, activeSession, sending, activeTurnRuntime, turnRuntimeRegistry } = createHarness({ sessionId: "local-delete-fail" });
    const first = { id: "m1", role: RoleEnum.USER, content: "first", turnScopeId: "turn-delete-fail" };
    const target = {
      id: "m2",
      role: RoleEnum.ASSISTANT,
      content: "target",
      pending: true,
      turnScopeId: "turn-delete-fail",
      channelState: { state: "sending", turnScopeId: "turn-delete-fail" },
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activateRuntimeTurn({ turnRuntimeRegistry, sessionId: "local-delete-fail", turnScopeId: "turn-delete-fail" });
    const actionPromise = engine.deleteMonotonicMessage(target, { timeoutMs: 20, pollIntervalMs: 5 });
    const rejectionExpectation = expect(actionPromise).rejects.toThrow("chat.monotonicActionStopTimeout");
    await vi.advanceTimersByTimeAsync(25);
    await rejectionExpectation;
    expect(activeSession.value.messages).toEqual([first, target]);
    vi.useRealTimers();
  });

  it("resendMonotonicMessage does not delete or send when stop precondition fails", async () => {
    vi.useFakeTimers();
    const stream = vi.fn(async () => {});
    const { engine, activeSession, sending, input, activeTurnRuntime, turnRuntimeRegistry } = createHarness({ sessionId: "local-resend-fail", stream });
    const first = { id: "m1", role: RoleEnum.USER, content: "first", turnScopeId: "turn-resend-fail" };
    const target = {
      id: "m2",
      role: RoleEnum.ASSISTANT,
      content: "target",
      pending: true,
      turnScopeId: "turn-resend-fail",
      channelState: { state: "sending", turnScopeId: "turn-resend-fail" },
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activateRuntimeTurn({ turnRuntimeRegistry, sessionId: "local-resend-fail", turnScopeId: "turn-resend-fail" });
    const actionPromise = engine.resendMonotonicMessage(target, "edited", { timeoutMs: 20, pollIntervalMs: 5 });
    const rejectionExpectation = expect(actionPromise).rejects.toThrow("chat.monotonicActionStopTimeout");
    await vi.advanceTimersByTimeAsync(25);
    await rejectionExpectation;
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(stream).not.toHaveBeenCalled();
    expect(input.value).toBe("hello");
    vi.useRealTimers();
  });

  it("clears a deleted stopped turn from the registry so the next send is not continue", async () => {
    const sessionId = "local-delete-stopped-registry";
    const turnScopeId = "turn-stopped-registry";
    const backendSession = makeSession(sessionId, { messages: [], rawMessages: [], version: 5 });
    const deleteSessionMessagesFromApi = vi.fn(async () => ({ ok: true, session: backendSession, version: 5 }));
    const applySessionDetail = vi.fn();
    const { engine, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId,
      deps: { deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = { id: "u1", turnScopeId, role: RoleEnum.USER, content: "first" };
    const target = {
      id: "a1",
      turnScopeId,
      role: RoleEnum.ASSISTANT,
      content: "target",
      channelState: { state: BackendChannelState.USER_STOPPED, turnScopeId },
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activeSession.value.version = 4;
    activateRuntimeTurn({ turnRuntimeRegistry, sessionId, turnScopeId });
    applyTurnRuntimeEvent(turnRuntimeRegistry.value, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED,
      sessionId,
      turnScopeId,
    });
    expect(resolveSessionTurnRuntime(turnRuntimeRegistry.value, sessionId)?.terminal).toBe("user_stopped");

    await expect(engine.deleteMonotonicMessage(target)).resolves.toBe(true);

    expect(resolveSessionTurnRuntime(turnRuntimeRegistry.value, sessionId)).toBe(null);
    expect(turnRuntimeRegistry.value.turns[turnScopeId]).toBeUndefined();
  });
});
