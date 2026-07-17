/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, beforeEach } from "vitest";
import { ref } from "vue";
import {
  BackendChannelState,
  BackendTerminalStates,
  FrontendRunState,
  FrontendTerminalStates,
  SESSION_RUN_EVENT,
  SESSION_RUN_MESSAGE_RUNTIME_ACTION,
  SESSION_RUN_MESSAGE_RUNTIME_MARK,
  SESSION_RUN_MESSAGE_RUNTIME_REASON,
  SESSION_RUN_TRANSITION_DECISION_REASON,
  SESSION_RUN_TRANSITION_GUARDS,
  SESSION_RUN_TRANSITION_TABLE,
  applySessionRunStateEvent,
  applySessionRunStateEvents,
  clearRememberedStopRequests,
  createInitialSessionRunState,
  evaluateSessionRunState,
  canApplyEvent,
  normalizeSessionRunEvent,
  reduceSessionRunEvents,
  rememberStopRequestedEvent,
  resolveEventScope,
  resolveNextStateByTransitionTable,
  resolveRememberedStopRequestedEvent,
  getMessageRuntimeChannelState,
  isMessageInFlightAssistant,
  isMessageRunning,
  resolveSessionRunMessageRuntimeView,
  resolveSessionRunMessageRuntimePatch,
  resolveSessionRunStateForMessage,
  resolveTransitionDecision,
  transitionSessionRunState,
} from "../../../../src/composables/chat/sessionRunStateMachine";

function installStorage() {
  const map = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: (key) => map.delete(key),
      clear: () => map.clear(),
    },
  });
}

describe("sessionRunStateMachine lifecycle", () => {
  beforeEach(() => installStorage());

  it("normalizes known event aliases and evaluates derived UI state", () => {
    const event = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "running",
      sessionId: " s1 ",
      turnScopeId: " c1 ",
    });
    expect(event.state).toBe(BackendChannelState.SENDING);
    expect(event.sessionId).toBe("s1");
    expect(event.turnScopeId).toBe("c1");
    const stoppingEvent = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: BackendChannelState.STOPPING,
      sessionId: "s1",
    });
    expect(stoppingEvent).toMatchObject({
      state: FrontendRunState.USER_STOPPING,
      backendState: BackendChannelState.STOPPING,
    });
    expect(evaluateSessionRunState({ state: FrontendRunState.USER_STOPPING })).toMatchObject({
      sending: true,
      canStop: false,
      assistantStatus: "user_stopping",
      stopLocked: true,
    });
  });

  it("keeps only local interaction locks in the global state machine", () => {
    const action = transitionSessionRunState(createInitialSessionRunState(), { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED });
    expect(action.state).toBe(FrontendRunState.ACTION_REQUESTING);
    expect(evaluateSessionRunState(action)).toMatchObject({ sending: true, canStartNewSend: false });
    const stop = transitionSessionRunState(action, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED });
    expect(stop.state).toBe(FrontendRunState.USER_STOPPING);
    expect(evaluateSessionRunState(stop)).toMatchObject({ sending: true, canDeleteMessage: false });
    const settled = transitionSessionRunState(stop, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED });
    expect(settled.state).toBe(FrontendRunState.IDLE);
    expect(evaluateSessionRunState(settled)).toMatchObject({ sending: false, canStartNewSend: true });
  });

  it("keeps backend completion out of the global lock and clears completion lock after summary", () => {
    const action = transitionSessionRunState(createInitialSessionRunState(), { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED });
    const backendCompleted = transitionSessionRunState(action, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "completed", dialogProcessId: "d1" });
    expect(backendCompleted.state).toBe(FrontendRunState.ACTION_REQUESTING);
    expect(backendCompleted).not.toHaveProperty("dialogProcessId");
    const requesting = transitionSessionRunState(backendCompleted, { type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED });
    expect(requesting.state).toBe(FrontendRunState.FRONTEND_COMPLETION_REQUESTING);
    const completed = transitionSessionRunState(requesting, { type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED });
    expect(completed.state).toBe(FrontendRunState.IDLE);
  });

  it("starts continue with an identity-free global action lock", () => {
    const continued = transitionSessionRunState(createInitialSessionRunState(), { type: SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED, sessionId: "s1", turnScopeId: "new-turn" });
    expect(continued.state).toBe(FrontendRunState.ACTION_REQUESTING);
    expect(continued).not.toHaveProperty("sessionId");
    expect(continued).not.toHaveProperty("turnScopeId");
    expect(continued).not.toHaveProperty("seq");
  });

  it("promotes backend processing to the identity-free global processing lock", () => {
    const action = transitionSessionRunState(createInitialSessionRunState(), { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED });
    const backend = transitionSessionRunState(action, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.SENDING, dialogProcessId: "d1" });
    expect(backend.state).toBe(FrontendRunState.PROCESSING);
    expect(backend).not.toHaveProperty("dialogProcessId");
    expect(evaluateSessionRunState(backend)).toMatchObject({ sending: true, canStop: true, canStartNewSend: false, canDeleteMessage: false });
  });

  it("locks new send, resend, and delete while backend stop confirmation is pending", () => {
    const sending = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    const stopRequesting = transitionSessionRunState(sending, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
    });
    expect(evaluateSessionRunState(stopRequesting)).toMatchObject({
      stopInFlight: true,
      awaitingBackendStop: true,
      canStartNewSend: false,
      canRetryMessage: false,
      canDeleteMessage: false,
    });

    const stopping = transitionSessionRunState(stopRequesting, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "stopping",
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(evaluateSessionRunState(stopping)).toMatchObject({
      stopInFlight: true,
      awaitingBackendStop: true,
      canStartNewSend: false,
      canRetryMessage: false,
      canDeleteMessage: false,
    });

    const stopped = transitionSessionRunState(stopping, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "user_stopped",
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(evaluateSessionRunState(stopped)).toMatchObject({
      stopInFlight: true,
      awaitingBackendStop: true,
      canStartNewSend: false,
      canRetryMessage: false,
      canDeleteMessage: false,
    });

    const completed = transitionSessionRunState(stopped, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED,
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(evaluateSessionRunState(completed)).toMatchObject({
      stopInFlight: false,
      awaitingBackendStop: false,
      canStartNewSend: true,
      canRetryMessage: true,
      canDeleteMessage: true,
    });
  });
});
