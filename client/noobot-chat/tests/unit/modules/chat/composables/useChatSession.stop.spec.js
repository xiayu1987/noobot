/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createChatSession,
  createSessionFixture,
  sessionLogClientMock,
  wsClientMock,
} from "./useChatSession.test-helpers.js";
import { useChatSession } from "../../../../../src/modules/chat/composables/useChatSession.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, ref } from "vue";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";
import { logResendDebug, setResendDebugLogSink } from "../../../../../src/modules/debug/loggers/resendDebugLogger.js";
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import { createTurnLifecycleEnvelope } from "@noobot/authoritative-state/contracts";
import {
  BackendChannelState,
  SESSION_RUN_EVENT,
} from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import {
  applyTurnLifecycleEnvelope,
  applyTurnRuntimeEvent,
  selectSessionTurnRuntime,
} from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";

function applyRuntimeEvent(store, event) {
  const registry = store.turnRuntimeRegistry;
  const result = applyTurnRuntimeEvent(registry, event);
  if (result?.applied) store.turnRuntimeRegistry = { ...registry };
  return result;
}

function applyLifecycle(store, {
  eventType,
  sessionId,
  turnScopeId,
  dialogProcessId,
  revision,
  phase,
  state,
  action = "send",
  executionState,
  canStop = false,
}) {
  const registry = store.turnRuntimeRegistry;
  const result = applyTurnLifecycleEnvelope(registry, createTurnLifecycleEnvelope({
    eventType,
    eventId: `${eventType}:${sessionId}:${turnScopeId}:${revision}`,
    commandId: `${action}:${turnScopeId}`,
    userId: "u-1",
    sessionId,
    turnScopeId,
    dialogProcessId,
    messageId: `event-message:${turnScopeId}`,
    presentationMessageId: `message:${turnScopeId}`,
    revision,
    sequence: revision,
    phase,
    state,
    action,
    executionState,
    capabilities: { actionLocked: true, canStop },
  }));
  if (result?.applied) store.turnRuntimeRegistry = { ...registry };
  return result;
}

function activateAuthorityTurn(store, sessionId, turnScopeId, dialogProcessId) {
  applyRuntimeEvent(store, {
    type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
    sessionId,
    turnScopeId,
    source: "test",
  });
  applyLifecycle(store, {
    eventType: "turn.action_accepted", sessionId, turnScopeId, dialogProcessId,
    revision: 1, phase: "action", state: "action_requesting", executionState: "accepted",
  });
  applyLifecycle(store, {
    eventType: "turn.processing_started", sessionId, turnScopeId, dialogProcessId,
    revision: 2, phase: "processing", state: "processing", executionState: "sending", canStop: true,
  });
}
describe("useChatSession reconnect replay", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const store = useChatStore();
    store.resetChatStore();
    Object.values(wsClientMock).forEach((mockFn) => {
      if (typeof mockFn?.mockReset === "function") mockFn.mockReset();
    });
    wsClientMock.reconnect.mockResolvedValue(undefined);
    sessionLogClientMock.log.mockClear();
    sessionLogClientMock.debug.mockClear();
    sessionLogClientMock.dispose.mockClear();
    setResendDebugLogSink(null);
    vi.unstubAllEnvs();
  });

  it("drives stop requesting, duplicate-stop guard, and terminal cleanup from the state machine", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "s-stop-request",
      backendSessionId: "s-stop-request",
      messages: [
        { role: RoleEnum.USER, content: "hello", turnScopeId: "turn-stop" },
        {
          role: RoleEnum.ASSISTANT,
          content: "partial",
          pending: true,
          channelState: { state: "sending" },
          turnScopeId: "turn-stop",
          dialogProcessId: "dp-stop",
        },
      ],
      rawMessages: [],
      messageCount: 2,
    })];
    store.activeSessionId = "s-stop-request";
    activateAuthorityTurn(store, "s-stop-request", "turn-stop", "dp-stop");
    wsClientMock.requestStop.mockReturnValue(true);

    const session = createChatSession();

    const requested = session.stopSending();
    await nextTick();

    expect(requested).toBe(true);
    expect(wsClientMock.requestStop).toHaveBeenCalledTimes(1);
    expect(session.composerActionState.value.stopRequesting).toBe(true);
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-stop-request")).toMatchObject({
      displayState: "stopping",
      sending: true,
      canStop: false,
    });

    const duplicateStop = session.stopSending();
    expect(duplicateStop).toBe(false);
    expect(wsClientMock.requestStop).toHaveBeenCalledTimes(1);

    applyLifecycle(store, {
      eventType: "turn.stop_accepted", sessionId: "s-stop-request", turnScopeId: "turn-stop",
      dialogProcessId: "dp-stop", revision: 3, phase: "stop", state: "stopping",
      action: "stop", executionState: "stopping",
    });
    applyLifecycle(store, {
      eventType: "turn.stop_processing_completed", sessionId: "s-stop-request", turnScopeId: "turn-stop",
      dialogProcessId: "dp-stop", revision: 4, phase: "stop", state: "stopping",
      action: "stop", executionState: "stopping",
    });
    await nextTick();

    expect(session.composerActionState.value).toMatchObject({
      stopRequesting: false,
      awaitingBackendStop: true,
      displayState: "stopping",
      userStopped: false,
      canStop: false,
    });
    expect(store.turnRuntimeRegistry.sessions["s-stop-request"].turns["turn-stop"]).toMatchObject({
      terminal: null,
      canStop: false,
    });
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-stop-request").canStop).toBe(false);
  });

  it("releases stop gates when stop request sending fails with a backend-style 404/409 error", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "s-stop-error",
      backendSessionId: "s-stop-error",
      messages: [
        { role: RoleEnum.USER, content: "hello", turnScopeId: "turn-stop-error" },
        {
          role: RoleEnum.ASSISTANT,
          content: "partial",
          pending: true,
          channelState: { state: "sending" },
          turnScopeId: "turn-stop-error",
          dialogProcessId: "dp-stop-error",
        },
      ],
      rawMessages: [],
      messageCount: 2,
    })];
    store.activeSessionId = "s-stop-error";
    activateAuthorityTurn(store, "s-stop-error", "turn-stop-error", "dp-stop-error");
    const stopError = new Error("conversation not found");
    stopError.response = { status: 404 };
    wsClientMock.requestStop.mockImplementationOnce(() => {
      throw stopError;
    });

    const session = createChatSession();
    const requested = session.stopSending();
    await nextTick();

    expect(requested).toBe(false);
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-stop-error").displayState).toBe("sending");
    expect(session.composerActionState.value.stopRequesting).toBe(false);
    expect(session.composerActionState.value.awaitingBackendStop).toBe(false);
    expect(session.composerActionState.value.canStop).toBe(true);
    expect(session.composerActionState.value.canStartNewSend).toBe(false);
    expect(session.composerActionState.value.canRetryMessage).toBe(false);
    expect(session.composerActionState.value.canDeleteMessage).toBe(false);
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-stop-error").sending).toBe(true);
  });

  it("releases stop gates when stop request asynchronously rejects with a backend-style 404/409 error", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "s-stop-async-error",
      backendSessionId: "s-stop-async-error",
      messages: [
        { role: RoleEnum.USER, content: "hello", turnScopeId: "turn-stop-async-error" },
        {
          role: RoleEnum.ASSISTANT,
          content: "partial",
          pending: true,
          channelState: { state: "sending" },
          turnScopeId: "turn-stop-async-error",
          dialogProcessId: "dp-stop-async-error",
        },
      ],
      rawMessages: [],
      messageCount: 2,
    })];
    store.activeSessionId = "s-stop-async-error";
    activateAuthorityTurn(store, "s-stop-async-error", "turn-stop-async-error", "dp-stop-async-error");
    const stopError = new Error("conversation conflict");
    stopError.response = { status: 409 };
    wsClientMock.requestStop.mockRejectedValueOnce(stopError);

    const session = createChatSession();
    const requested = await session.stopSending();
    await nextTick();

    expect(requested).toBe(false);
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-stop-async-error").displayState).toBe("sending");
    expect(session.composerActionState.value.stopRequesting).toBe(false);
    expect(session.composerActionState.value.awaitingBackendStop).toBe(false);
    expect(session.composerActionState.value.canStop).toBe(true);
    expect(session.composerActionState.value.canStartNewSend).toBe(false);
    expect(session.composerActionState.value.canRetryMessage).toBe(false);
    expect(session.composerActionState.value.canDeleteMessage).toBe(false);
    expect(selectSessionTurnRuntime(store.turnRuntimeRegistry, "s-stop-async-error").sending).toBe(true);
  });
});
