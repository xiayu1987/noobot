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
} from "../../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import { deriveTurnCapabilities, reduceTurnRuntimeEvent } from "../../../../../../src/modules/chat/runtime/run-state-machine/turnReducer.js";
import { TURN_EVENT, TURN_PHASE, TURN_STATE } from "@noobot/session-protocol";

const processingStarted = { type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: TURN_EVENT.PROCESSING_STARTED, state: TURN_STATE.PROCESSING, phase: TURN_PHASE.PROCESSING, executionState: BackendChannelState.SENDING, capabilities: { actionLocked: true, canStop: true } };
const actionAccepted = { type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: TURN_EVENT.ACTION_ACCEPTED, state: TURN_STATE.ACTION_REQUESTING, phase: TURN_PHASE.ACTION, action: "send" };
const processingCompleted = { type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: TURN_EVENT.PROCESSING_COMPLETED, state: TURN_STATE.COMPLETION_REQUESTING, phase: TURN_PHASE.COMPLETION };
const stopAccepted = { type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: TURN_EVENT.STOP_ACCEPTED, state: TURN_STATE.ACTION_REQUESTING, phase: TURN_PHASE.STOP, action: "stop" };
const stopProcessingCompleted = { type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: TURN_EVENT.STOP_PROCESSING_COMPLETED, state: TURN_STATE.STOPPING, phase: TURN_PHASE.STOP };
const completionCommit = { completionCommitId: "completion-commit-1", summaryVersion: 1 };
const terminalResolved = (state) => ({ type: SESSION_RUN_EVENT.TERMINAL_RESOLVED, state, revision: 10, sequence: 10, ...completionCommit });

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

  it("keeps lifecycle phases locked until the authoritative terminal event", () => {
    let turn = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED });
    expect(turn).toMatchObject({ commandPending: true, pendingCommandType: "action" });
    expect(turn.state).toBeUndefined();
    turn = apply(turn, actionAccepted);
    turn = apply(turn, processingStarted);
    expect(turn.state).toBe(FrontendRunState.PROCESSING);
    turn = apply(turn, processingCompleted);
    expect(turn.state).toBe(FrontendRunState.FRONTEND_COMPLETION_REQUESTING);
    turn = apply(turn, { type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: TURN_EVENT.COMPLETED, state: TURN_STATE.COMPLETED, phase: TURN_PHASE.COMPLETION, ...completionCommit });
    expect(turn.state).toBe(FrontendRunState.FRONTEND_COMPLETED);
    turn = apply(turn, terminalResolved(TURN_STATE.COMPLETED));
    expect(turn.state).toBe(FrontendRunState.FRONTEND_COMPLETED);
    expect(deriveTurnCapabilities(turn.state, turn).actionLocked).toBe(false);
  });

  it("starts continue as a new identity-bound action", () => {
    const turn = apply(null, { type: SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED, action: "continue" });
    expect(turn).toMatchObject({ commandPending: true, pendingCommandType: "action", action: "continue" });
    expect(turn.state).toBeUndefined();
  });

  it("promotes only an authoritative lifecycle fact to processing with stop capability", () => {
    const localRequest = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED });
    const requesting = apply(localRequest, actionAccepted);
    const transport = apply(requesting, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.SENDING });
    expect(deriveTurnCapabilities(transport.state, transport).canStop).toBe(false);
    const processing = apply(transport, processingStarted);
    expect(deriveTurnCapabilities(processing.state, processing)).toMatchObject({ sending: true, canStop: true, actionLocked: true });
  });

  it("keeps stop locked through request, backend confirmation, and summary", () => {
    let turn = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED });
    turn = apply(turn, actionAccepted);
    turn = apply(turn, processingStarted);
    turn = apply(turn, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED });
    expect(turn).toMatchObject({ state: FrontendRunState.PROCESSING, commandPending: true, pendingCommandType: "stop", action: "stop" });
    turn = apply(turn, stopAccepted);
    turn = apply(turn, stopProcessingCompleted);
    expect(turn.state).toBe(FrontendRunState.USER_STOPPING);
    turn = apply(turn, terminalResolved(TURN_STATE.STOP_COMPLETED));
    expect(turn.state).toBe(FrontendRunState.USER_STOP_COMPLETED);
    expect(deriveTurnCapabilities(turn.state, turn)).toMatchObject({ actionLocked: false, terminal: true });
  });
});
