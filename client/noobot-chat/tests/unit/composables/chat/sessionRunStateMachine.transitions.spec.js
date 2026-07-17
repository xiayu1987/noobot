/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import {
  FrontendRunState,
  SESSION_RUN_EVENT,
  applySessionRunStateEvent,
  applySessionRunStateEvents,
  createInitialSessionRunState,
  evaluateSessionRunState,
  reduceSessionRunEvents,
  transitionSessionRunState,
} from "../../../../src/composables/chat/sessionRunStateMachine";

const transientStates = [
  FrontendRunState.ACTION_REQUESTING,
  FrontendRunState.PROCESSING,
  FrontendRunState.FRONTEND_COMPLETION_REQUESTING,
  FrontendRunState.USER_STOPPING,
];

const resetEvents = [
  SESSION_RUN_EVENT.LOCAL_RESET,
  SESSION_RUN_EVENT.LOCAL_FAILURE,
  SESSION_RUN_EVENT.LOCAL_RESEND_COMPLETED,
  SESSION_RUN_EVENT.LOCAL_RESEND_FAILED,
  SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED,
  SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED,
  SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED,
  SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_FAILED,
];

describe("sessionRunStateMachine interaction lock", () => {
  it.each([
    SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
    SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
    SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED,
    SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
    SESSION_RUN_EVENT.LOCAL_RESEND_REPLACING_TURN,
    SESSION_RUN_EVENT.LOCAL_RESEND_STREAMING,
  ])("maps %s to the frontend action lock without retaining turn identity", (type) => {
    const next = transitionSessionRunState(createInitialSessionRunState(), {
      type,
      sessionId: "s1",
      dialogProcessId: "dp1",
      turnScopeId: "turn1",
    });
    expect(next.state).toBe(FrontendRunState.ACTION_REQUESTING);
    expect(next).not.toHaveProperty("sessionId");
    expect(next).not.toHaveProperty("dialogProcessId");
    expect(next).not.toHaveProperty("turnScopeId");
  });

  it("uses distinct completion and stop locks", () => {
    expect(transitionSessionRunState({}, {
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED,
    }).state).toBe(FrontendRunState.FRONTEND_COMPLETION_REQUESTING);
    expect(transitionSessionRunState({}, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
    }).state).toBe(FrontendRunState.USER_STOPPING);
  });

  it.each(resetEvents)("clears the interaction lock on %s", (type) => {
    for (const state of transientStates) {
      const next = transitionSessionRunState({ ...createInitialSessionRunState(), state }, { type });
      expect(next.state).toBe(FrontendRunState.IDLE);
      expect(evaluateSessionRunState(next)).toMatchObject({ sending: false, terminal: true });
    }
  });

  it("enters processing only for backend in-flight acknowledgements", () => {
    const current = { ...createInitialSessionRunState(), state: FrontendRunState.ACTION_REQUESTING };
    for (const event of [
      { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "sending" },
      { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "reconnecting" },
      { type: SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE, state: "interaction_pending" },
    ]) {
      expect(transitionSessionRunState(current, event).state).toBe(FrontendRunState.PROCESSING);
    }
    expect(transitionSessionRunState(current, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "completed",
    }).state).toBe(FrontendRunState.ACTION_REQUESTING);
  });

  it("locks every interaction in the explicit request and processing states", () => {
    for (const state of transientStates) {
      expect(evaluateSessionRunState({ state })).toMatchObject({
        sending: true,
        canStartNewSend: false,
        canRetryMessage: false,
        canDeleteMessage: false,
        terminal: false,
      });
    }
    expect(evaluateSessionRunState(createInitialSessionRunState())).toMatchObject({
      sending: false,
      canStartNewSend: true,
      canRetryMessage: true,
      canDeleteMessage: true,
      terminal: true,
    });
    for (const state of [null, undefined, "", "unknown", "sending", "completed"]) {
      expect(evaluateSessionRunState({ state })).toMatchObject({
        state: FrontendRunState.IDLE,
        sending: false,
        canStartNewSend: true,
        terminal: true,
      });
    }
  });

  it("shows stop only after the backend acknowledges processing", () => {
    const stateRef = ref(createInitialSessionRunState());
    const sending = ref(false);
    const canStop = ref(false);
    applySessionRunStateEvent({
      stateRef,
      sending,
      canStop,
      event: { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED },
    });
    expect([stateRef.value.state, sending.value, canStop.value]).toEqual([
      FrontendRunState.ACTION_REQUESTING,
      true,
      false,
    ]);
    applySessionRunStateEvent({
      stateRef,
      sending,
      canStop,
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "sending", source: "reconnect" },
    });
    expect([stateRef.value.state, sending.value, canStop.value]).toEqual([
      FrontendRunState.PROCESSING,
      true,
      true,
    ]);
    applySessionRunStateEvents({
      stateRef,
      sending,
      canStop,
      events: [{ type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED }],
    });
    expect([stateRef.value.state, sending.value, canStop.value]).toEqual([
      FrontendRunState.IDLE,
      false,
      false,
    ]);
  });

  it("reduces sequential local actions deterministically", () => {
    const next = reduceSessionRunEvents(createInitialSessionRunState(), [
      { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED },
      { type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED },
      { type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED },
    ]);
    expect(next.state).toBe(FrontendRunState.IDLE);
  });
});
