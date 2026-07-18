/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  BackendChannelState,
  FrontendRunState,
  SESSION_RUN_EVENT,
  clearRememberedStopRequests,
  evaluateSessionRunState,
  normalizeSessionRunEvent,
} from "../../../../src/composables/chat/sessionRunStateMachine";
import { deriveTurnCapabilities, reduceTurnRuntimeEvent } from "../../../../src/composables/chat/sessionRunStateMachine/turnReducer";

function installStorage() {
  const map = new Map();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key), clear: () => map.clear(),
  } });
}

function apply(current, event) {
  const result = reduceTurnRuntimeEvent(current, { sessionId: "s1", turnScopeId: "turn-1", dialogProcessId: "d1", ...event });
  expect(result.applied, result.reason).toBe(true);
  return result.next;
}

describe("sessionRunStateMachine lifecycle", () => {
  beforeEach(() => { installStorage(); clearRememberedStopRequests(); });

  it("normalizes aliases and evaluates the stop-summary phase", () => {
    const event = normalizeSessionRunEvent({ type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "running", sessionId: " s1 ", turnScopeId: " c1 " });
    expect(event).toMatchObject({ state: BackendChannelState.SENDING, sessionId: "s1", turnScopeId: "c1" });
    expect(evaluateSessionRunState({ state: FrontendRunState.USER_STOPPING })).toMatchObject({ sending: true, canStop: false, stopLocked: true });
  });

  it("keeps every lifecycle phase locked until its terminal summary", () => {
    let turn = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED });
    expect(deriveTurnCapabilities(turn.state, turn).actionLocked).toBe(true);
    turn = apply(turn, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.SENDING });
    expect(turn.state).toBe(FrontendRunState.PROCESSING);
    turn = apply(turn, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.COMPLETED });
    expect(turn.state).toBe(FrontendRunState.FRONTEND_COMPLETION_REQUESTING);
    turn = apply(turn, { type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED });
    expect(turn.state).toBe(FrontendRunState.FRONTEND_COMPLETED);
    expect(deriveTurnCapabilities(turn.state, turn).actionLocked).toBe(false);
  });

  it("starts continue as a new identity-bound action", () => {
    const turn = apply(null, { type: SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED, action: "continue" });
    expect(turn).toMatchObject({ state: FrontendRunState.ACTION_REQUESTING, action: "continue" });
  });

  it("promotes backend acknowledgement to processing with stop capability", () => {
    const requesting = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED });
    const processing = apply(requesting, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.SENDING });
    expect(deriveTurnCapabilities(processing.state, processing)).toMatchObject({ sending: true, canStop: true, actionLocked: true });
  });

  it("keeps stop locked through request, backend confirmation, and summary", () => {
    let turn = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED });
    turn = apply(turn, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.SENDING });
    turn = apply(turn, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED });
    expect(turn).toMatchObject({ state: FrontendRunState.ACTION_REQUESTING, action: "stop" });
    turn = apply(turn, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.USER_STOPPED });
    expect(turn.state).toBe(FrontendRunState.USER_STOPPING);
    turn = apply(turn, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED });
    expect(turn.state).toBe(FrontendRunState.USER_STOP_COMPLETED);
    expect(deriveTurnCapabilities(turn.state, turn)).toMatchObject({ actionLocked: false, terminal: true });
  });
});
