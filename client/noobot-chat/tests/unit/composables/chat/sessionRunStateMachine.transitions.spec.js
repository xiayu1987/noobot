/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  BackendChannelState,
  FrontendRunState,
  SESSION_RUN_EVENT,
} from "../../../../src/composables/chat/sessionRunStateMachine";
import {
  deriveTurnCapabilities,
  reduceTurnRuntimeEvent,
  TURN_TRANSITION_REASON,
} from "../../../../src/composables/chat/sessionRunStateMachine/turnReducer";

const identity = { sessionId: "s1", turnScopeId: "turn-1", dialogProcessId: "dp-1" };

function apply(current, event) {
  const result = reduceTurnRuntimeEvent(current, { ...identity, ...event });
  expect(result.applied, result.reason).toBe(true);
  return { ...result.next, ...identity };
}

describe("turn runtime interaction lifecycle", () => {
  it.each([
    SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
    SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
    SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED,
    SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
    SESSION_RUN_EVENT.LOCAL_RESEND_REPLACING_TURN,
    SESSION_RUN_EVENT.LOCAL_RESEND_STREAMING,
  ])("starts %s as a new identity-bound action request", (type) => {
    const next = apply(null, { type });
    expect(next).toMatchObject({ ...identity, state: FrontendRunState.ACTION_REQUESTING });
    expect(deriveTurnCapabilities(next.state, next)).toMatchObject({ sending: true, canStop: false });
  });

  it("enters processing only after a backend in-flight acknowledgement", () => {
    const requesting = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED });
    const processing = apply(requesting, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: BackendChannelState.SENDING,
    });
    expect(processing.state).toBe(FrontendRunState.PROCESSING);

    for (const state of [BackendChannelState.RECONNECTING, BackendChannelState.INTERACTION_PENDING]) {
      const result = reduceTurnRuntimeEvent(requesting, {
        ...identity,
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
        state,
      });
      expect(result).toMatchObject({ applied: false, reason: TURN_TRANSITION_REASON.ILLEGAL_TRANSITION });
      expect(requesting.state).toBe(FrontendRunState.ACTION_REQUESTING);
      expect(deriveTurnCapabilities(requesting.state, requesting)).toMatchObject({
        sending: true,
        canStop: false,
      });
    }
  });

  it("runs completion through processing, completion request, and summary application", () => {
    let turn = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED });
    turn = apply(turn, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.SENDING });
    turn = apply(turn, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.COMPLETED });
    expect(turn.state).toBe(FrontendRunState.FRONTEND_COMPLETION_REQUESTING);
    turn = apply(turn, { type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED });
    expect(turn.state).toBe(FrontendRunState.FRONTEND_COMPLETED);
    expect(deriveTurnCapabilities(turn.state, turn)).toMatchObject({ sending: false, terminal: true });
  });

  it("keeps stop in action-requesting until backend confirms stopping", () => {
    let turn = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED });
    turn = apply(turn, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.SENDING });
    turn = apply(turn, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED });
    expect(turn).toMatchObject({ state: FrontendRunState.ACTION_REQUESTING, action: "stop" });
    expect(deriveTurnCapabilities(turn.state, turn)).toMatchObject({ sending: true, canStop: false });
    turn = apply(turn, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.USER_STOPPED });
    expect(turn.state).toBe(FrontendRunState.USER_STOPPING);
    turn = apply(turn, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED });
    expect(turn.state).toBe(FrontendRunState.USER_STOP_COMPLETED);
  });

  it("classifies failures by the active phase", () => {
    const requesting = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED });
    expect(apply(requesting, { type: SESSION_RUN_EVENT.LOCAL_FAILURE }).state).toBe(FrontendRunState.ACTION_REQUEST_ERROR);

    const processing = apply(requesting, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.SENDING });
    expect(apply(processing, { type: SESSION_RUN_EVENT.LOCAL_FAILURE }).state).toBe(FrontendRunState.PROCESSING_ERROR);

    const completing = apply(processing, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.COMPLETED });
    expect(apply(completing, { type: SESSION_RUN_EVENT.LOCAL_FAILURE }).state).toBe(FrontendRunState.COMPLETION_ERROR);

    const stopRequesting = apply(processing, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED });
    const stopping = apply(stopRequesting, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.USER_STOPPED });
    expect(apply(stopping, { type: SESSION_RUN_EVENT.LOCAL_FAILURE }).state).toBe(FrontendRunState.STOP_ERROR);
  });

  it("rejects an illegal second action and stale or terminal events", () => {
    const requesting = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED, seq: 2 });
    expect(reduceTurnRuntimeEvent(requesting, { ...identity, type: SESSION_RUN_EVENT.LOCAL_RESEND_STARTED, seq: 3 })).toMatchObject({
      applied: false,
      reason: TURN_TRANSITION_REASON.ILLEGAL_TRANSITION,
    });
    expect(reduceTurnRuntimeEvent(requesting, { ...identity, type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.SENDING, seq: 1 })).toMatchObject({
      applied: false,
      reason: TURN_TRANSITION_REASON.STALE_SEQUENCE,
    });

    let completed = apply(requesting, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.SENDING, seq: 3 });
    completed = apply(completed, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.COMPLETED, seq: 4 });
    completed = apply(completed, { type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED, seq: 5 });
    expect(reduceTurnRuntimeEvent(completed, { ...identity, type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.SENDING, seq: 6 })).toMatchObject({
      applied: false,
      reason: TURN_TRANSITION_REASON.TERMINAL_LOCKED,
    });
  });
});
