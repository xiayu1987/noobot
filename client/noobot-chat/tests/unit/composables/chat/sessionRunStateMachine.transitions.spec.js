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
import { TURN_EVENT, TURN_PHASE, TURN_STATE } from "@noobot/shared/turn-lifecycle-protocol";

const identity = { sessionId: "s1", turnScopeId: "turn-1", dialogProcessId: "dp-1" };
const actionAccepted = { type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: TURN_EVENT.ACTION_ACCEPTED, phase: TURN_PHASE.ACTION, action: "send" };
const processingStarted = { type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: TURN_EVENT.PROCESSING_STARTED, phase: TURN_PHASE.PROCESSING, executionState: BackendChannelState.SENDING };
const processingCompleted = { type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: TURN_EVENT.PROCESSING_COMPLETED, phase: TURN_PHASE.COMPLETION };
const stopProcessingCompleted = { type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: TURN_EVENT.STOP_PROCESSING_COMPLETED, phase: TURN_PHASE.STOP };
const completionCommit = { completionCommitId: "completion-commit-1", summaryVersion: 1 };
const authoritativeCompleted = { type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: TURN_EVENT.COMPLETED, phase: TURN_PHASE.COMPLETION, ...completionCommit };
const terminalResolved = (state, overrides = {}) => ({
  type: SESSION_RUN_EVENT.TERMINAL_RESOLVED,
  state,
  revision: 100,
  sequence: 100,
  ...completionCommit,
  terminalMaterialization: { terminalStatus: { status: state }, messages: [] },
  ...(state.endsWith("_failed") ? { failure: { phase: state.replace(/_failed$/, ""), message: "failed" } } : {}),
  ...overrides,
});

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

  it("enters processing only after an authoritative lifecycle fact", () => {
    const localRequest = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED });
    const requesting = apply(localRequest, actionAccepted);
    const transport = apply(requesting, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.SENDING });
    expect(transport.state).toBe(FrontendRunState.ACTION_REQUESTING);
    expect(deriveTurnCapabilities(transport.state, transport).canStop).toBe(false);
    const processing = apply(transport, processingStarted);
    expect(processing.state).toBe(FrontendRunState.PROCESSING);

    for (const state of [BackendChannelState.RECONNECTING, BackendChannelState.INTERACTION_PENDING]) {
      const result = reduceTurnRuntimeEvent(requesting, {
        ...identity,
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
        state,
      });
      expect(result).toMatchObject({ applied: true });
      expect(requesting.state).toBe(FrontendRunState.ACTION_REQUESTING);
      expect(deriveTurnCapabilities(requesting.state, requesting)).toMatchObject({
        sending: true,
        canStop: false,
      });
    }
  });

  it("keeps a completion notification locked until Terminal Resolution settles it", () => {
    let turn = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED });
    turn = apply(turn, processingStarted);
    turn = apply(turn, processingCompleted);
    expect(turn.state).toBe(FrontendRunState.FRONTEND_COMPLETION_REQUESTING);
    turn = apply(turn, authoritativeCompleted);
    expect(turn.state).toBe(FrontendRunState.FRONTEND_COMPLETION_REQUESTING);
    turn = apply(turn, terminalResolved(TURN_STATE.COMPLETED));
    expect(turn.state).toBe(FrontendRunState.FRONTEND_COMPLETED);
    expect(deriveTurnCapabilities(turn.state, turn)).toMatchObject({ sending: false, terminal: true });
  });

  it("keeps stop in action-requesting until backend confirms stopping", () => {
    let turn = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED });
    turn = apply(turn, processingStarted);
    turn = apply(turn, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED });
    expect(turn).toMatchObject({ state: FrontendRunState.ACTION_REQUESTING, action: "stop" });
    expect(deriveTurnCapabilities(turn.state, turn)).toMatchObject({ sending: true, canStop: false });
    turn = apply(turn, stopProcessingCompleted);
    expect(turn.state).toBe(FrontendRunState.USER_STOPPING);
    turn = apply(turn, terminalResolved(TURN_STATE.STOP_COMPLETED));
    expect(turn.state).toBe(FrontendRunState.USER_STOP_COMPLETED);
  });

  it("settles failures only from an authoritative Terminal Resolution", () => {
    const requesting = apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED });
    expect(apply(requesting, terminalResolved(TURN_STATE.ACTION_FAILED)).state).toBe(FrontendRunState.ACTION_REQUEST_ERROR);

    const processing = apply(requesting, processingStarted);
    expect(apply(processing, terminalResolved(TURN_STATE.PROCESSING_FAILED)).state).toBe(FrontendRunState.PROCESSING_ERROR);

    const completing = apply(processing, processingCompleted);
    expect(apply(completing, terminalResolved(TURN_STATE.COMPLETION_FAILED)).state).toBe(FrontendRunState.COMPLETION_ERROR);

    const stopRequesting = apply(processing, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED });
    const stopping = apply(stopRequesting, stopProcessingCompleted);
    expect(apply(stopping, terminalResolved(TURN_STATE.STOP_FAILED)).state).toBe(FrontendRunState.STOP_ERROR);
  });

  it.each([
    [TURN_PHASE.ACTION, FrontendRunState.ACTION_REQUEST_ERROR],
    [TURN_PHASE.PROCESSING, FrontendRunState.PROCESSING_ERROR],
    [TURN_PHASE.COMPLETION, FrontendRunState.COMPLETION_ERROR],
    [TURN_PHASE.STOP, FrontendRunState.STOP_ERROR],
  ])("maps authoritative %s failures to their phase terminal", (phase, expectedState) => {
    const currentByPhase = {
      [TURN_PHASE.ACTION]: apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED }),
      [TURN_PHASE.PROCESSING]: apply(apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED }), processingStarted),
      [TURN_PHASE.COMPLETION]: apply(
        apply(apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED }), processingStarted),
        processingCompleted,
      ),
      [TURN_PHASE.STOP]: apply(
        apply(
          apply(apply(null, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED }), processingStarted),
          { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED },
        ),
        stopProcessingCompleted,
      ),
    };
    const protocolState = {
      [TURN_PHASE.ACTION]: TURN_STATE.ACTION_FAILED,
      [TURN_PHASE.PROCESSING]: TURN_STATE.PROCESSING_FAILED,
      [TURN_PHASE.COMPLETION]: TURN_STATE.COMPLETION_FAILED,
      [TURN_PHASE.STOP]: TURN_STATE.STOP_FAILED,
    }[phase];
    const notification = apply(currentByPhase[phase], {
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      eventType: TURN_EVENT.FAILED,
      phase,
    });
    expect(notification.state).toBe(currentByPhase[phase].state);
    const failed = apply(notification, terminalResolved(protocolState));
    expect(failed).toMatchObject({ state: expectedState, terminal: "error" });
  });

  it.each([
    [TURN_PHASE.COMPLETION, FrontendRunState.COMPLETION_ERROR, TURN_EVENT.COMPLETED, FrontendRunState.FRONTEND_COMPLETED],
    [TURN_PHASE.STOP, FrontendRunState.STOP_ERROR, TURN_EVENT.STOP_COMPLETED, FrontendRunState.USER_STOP_COMPLETED],
  ])("allows only the matching authoritative success to settle retryable %s failure", (phase, failedState, successEvent, completedState) => {
    const failed = {
      ...identity,
      state: failedState,
      action: phase === TURN_PHASE.STOP ? "stop" : "send",
      terminal: null,
      lifecycleObserved: true,
      finalizeIntent: { type: phase, retryable: true },
    };
    expect(deriveTurnCapabilities(failed.state, failed)).toMatchObject({ terminal: false, sending: true });
    const notification = reduceTurnRuntimeEvent(failed, { ...identity, type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: successEvent, phase, revision: 2 });
    expect(notification).toMatchObject({ applied: true });
    expect(notification.next.state).toBe(
      phase === TURN_PHASE.STOP
        ? FrontendRunState.USER_STOPPING
        : FrontendRunState.FRONTEND_COMPLETION_REQUESTING,
    );
    const completedTurn = apply(notification.next, terminalResolved(
      phase === TURN_PHASE.STOP ? TURN_STATE.STOP_COMPLETED : TURN_STATE.COMPLETED,
      { revision: 3, sequence: 3 },
    ));
    expect(completedTurn).toMatchObject({ state: completedState });
    expect(completedTurn.terminal).toBe(phase === TURN_PHASE.STOP ? "user_stopped" : "completed");
  });

  it.each([
    [FrontendRunState.COMPLETION_ERROR, TURN_EVENT.COMPLETED],
    [FrontendRunState.STOP_ERROR, TURN_EVENT.STOP_COMPLETED],
  ])("locks non-retryable finalize failure %s", (state, eventType) => {
    const failed = { ...identity, state, terminal: "error", finalizeIntent: { retryable: false } };
    expect(reduceTurnRuntimeEvent(failed, {
      ...identity,
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      eventType,
    })).toMatchObject({ applied: false, reason: TURN_TRANSITION_REASON.TERMINAL_LOCKED });
  });

  it.each([
    [FrontendRunState.COMPLETION_ERROR, TURN_EVENT.STOP_COMPLETED, TURN_PHASE.STOP],
    [FrontendRunState.STOP_ERROR, TURN_EVENT.COMPLETED, TURN_PHASE.COMPLETION],
  ])("rejects mismatched success %s for retryable failure %s", (state, eventType, phase) => {
    const failed = { ...identity, state, terminal: null, lifecycleObserved: true, finalizeIntent: { retryable: true } };
    expect(reduceTurnRuntimeEvent(failed, {
      ...identity,
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      eventType,
      phase,
    })).toMatchObject({ applied: false, reason: TURN_TRANSITION_REASON.ILLEGAL_TRANSITION });
  });

  it("does not let transport cancelled override an authoritative Turn", () => {
    const processing = {
      ...identity,
      state: FrontendRunState.PROCESSING,
      lifecycleObserved: true,
      backendState: BackendChannelState.SENDING,
    };
    const result = reduceTurnRuntimeEvent(processing, {
      ...identity,
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: FrontendRunState.CANCELLED,
    });
    expect(result).toMatchObject({ applied: true, next: { state: FrontendRunState.PROCESSING, terminal: null } });
  });

  it.each([
    FrontendRunState.FRONTEND_COMPLETED,
    FrontendRunState.USER_STOP_COMPLETED,
    FrontendRunState.CANCELLED,
    FrontendRunState.ACTION_REQUEST_ERROR,
    FrontendRunState.PROCESSING_ERROR,
    FrontendRunState.COMPLETION_ERROR,
    FrontendRunState.STOP_ERROR,
  ])("locks terminal state %s against every later lifecycle branch", (state) => {
    const current = { ...identity, state, terminal: state.includes("completed") ? "completed" : "error" };
    for (const event of [
      { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED },
      processingStarted,
      processingCompleted,
      { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED },
      { type: SESSION_RUN_EVENT.LOCAL_FAILURE },
    ]) {
      expect(reduceTurnRuntimeEvent(current, { ...identity, ...event })).toMatchObject({
        applied: false,
        reason: TURN_TRANSITION_REASON.TERMINAL_LOCKED,
      });
    }
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

    let completed = apply(requesting, { ...processingStarted, seq: 3 });
    completed = apply(completed, { ...processingCompleted, seq: 4 });
    completed = apply(completed, { ...authoritativeCompleted, seq: 5 });
    completed = apply(completed, terminalResolved(TURN_STATE.COMPLETED, { revision: 6, sequence: 6 }));
    expect(reduceTurnRuntimeEvent(completed, { ...identity, type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: BackendChannelState.SENDING, seq: 7 })).toMatchObject({
      applied: false,
      reason: TURN_TRANSITION_REASON.TERMINAL_LOCKED,
    });
  });
});
