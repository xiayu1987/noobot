/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, it, expect } from "vitest";
import {
  createTurnRuntimeRegistryState,
  applyTurnRuntimeEvent,
  resolveSessionTurnRuntime,
  resolveLatestStoppedTurn,
  selectSessionTurnRuntime,
  selectTurnMessageRuntime,
  turnRuntimeDisplayState,
  hydrateSessionTurnRuntime,
} from "../../../../../src/composables/chat/sessionRunStateMachine/turnRuntimeRegistry";
import { SESSION_RUN_EVENT, BackendChannelState } from "../../../../../src/composables/chat/sessionRunStateMachine/constants";

function sendStart(registry, { sessionId, turnScopeId, seq = 1 }) {
  return applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED, sessionId, turnScopeId, seq });
}
function backendState(registry, { sessionId, turnScopeId, dialogProcessId, state, seq }) {
  return applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, sessionId, turnScopeId, dialogProcessId, state, seq });
}

describe("turnRuntimeRegistry", () => {
  it("creates and activates a session turn", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    expect(resolveSessionTurnRuntime(registry, "s1")).toMatchObject({ turnScopeId: "t1" });
    expect(turnRuntimeDisplayState(resolveSessionTurnRuntime(registry, "s1"))).toBe("requesting");
  });
  it("binds backend identity and exposes stop eligibility", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", state: BackendChannelState.SENDING, seq: 2 });
    expect(resolveSessionTurnRuntime(registry, "s1")).toMatchObject({ dialogProcessId: "dp1", canStop: true });
    expect(registry.turnByDialogProcess.dp1).toBe("t1");
  });
  it.each([
    BackendChannelState.RECONNECTING,
    BackendChannelState.INTERACTION_PENDING,
  ])("keeps %s action-locked but rejects stop without mutating the turn", (state) => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    backendState(registry, {
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "dp1",
      state,
      seq: 2,
    });
    const before = { ...resolveSessionTurnRuntime(registry, "s1") };

    expect(selectSessionTurnRuntime(registry, "s1")).toMatchObject({
      sending: true,
      canStop: false,
      displayState: "sending",
    });
    const stopped = applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "dp1",
      seq: 3,
    });

    expect(stopped).toMatchObject({ applied: false, reason: "stop_not_allowed" });
    expect(resolveSessionTurnRuntime(registry, "s1")).toEqual(before);
  });
  it("routes later events by dialogProcessId", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", state: BackendChannelState.SENDING, seq: 2 });
    const result = applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, sessionId: "s1", dialogProcessId: "dp1", state: BackendChannelState.COMPLETED, seq: 3 });
    expect(result.turn).toMatchObject({ turnScopeId: "t1", state: "frontend_completion_requesting", terminal: null });
  });
  it("locks terminal turns and rejects stale or conflicting events", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1", seq: 5 });
    expect(backendState(registry, { sessionId: "s1", turnScopeId: "t1", state: BackendChannelState.SENDING, seq: 2 }).applied).toBe(false);
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", state: BackendChannelState.SENDING, seq: 6 });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", state: BackendChannelState.COMPLETED, seq: 7 });
    applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED, sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", seq: 8 });
    expect(backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp2", state: BackendChannelState.SENDING, seq: 7 }).applied).toBe(false);
    expect(resolveSessionTurnRuntime(registry, "s1")).toMatchObject({ terminal: "completed", canStop: false });
  });
  it("rejects phase regression when late events have no usable sequence", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1", seq: 0 });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", state: BackendChannelState.SENDING, seq: 0 });
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
      sessionId: "s1",
      turnScopeId: "t1",
    });

    const lateSending = backendState(registry, {
      sessionId: "s1",
      turnScopeId: "t1",
      state: BackendChannelState.SENDING,
      seq: 0,
    });

    expect(lateSending.applied).toBe(false);
    expect(resolveSessionTurnRuntime(registry, "s1")).toMatchObject({
      state: "frontend_action_requesting",
      canStop: false,
    });
  });
  it("keeps stopping after real-time user_stopped until the authoritative summary is applied", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1", seq: 1 });
    backendState(registry, {
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "dp1",
      state: BackendChannelState.SENDING,
      seq: 2,
    });
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED,
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "dp1",
      seq: 3,
    });

    const stopped = backendState(registry, {
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "dp1",
      state: BackendChannelState.USER_STOPPED,
      seq: 4,
    });

    expect(stopped.applied).toBe(true);
    expect(stopped.turn).toMatchObject({
      state: "frontend_user_stopping",
      terminal: null,
      canStop: false,
    });
    expect(turnRuntimeDisplayState(stopped.turn)).toBe("stopping");

    const summarized = applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED,
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "dp1",
      seq: 5,
    });
    expect(summarized.turn).toMatchObject({
      terminal: "user_stopped",
      canStop: false,
    });
    expect(turnRuntimeDisplayState(summarized.turn)).toBe("continue");
  });
  it("rejects stale or conflicting real-time user_stopped events", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1", seq: 5 });
    backendState(registry, {
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "dp1",
      state: BackendChannelState.SENDING,
      seq: 6,
    });

    expect(backendState(registry, {
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "dp1",
      state: BackendChannelState.USER_STOPPED,
      seq: 4,
    }).applied).toBe(false);
    expect(backendState(registry, {
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "other-dialog",
      state: BackendChannelState.USER_STOPPED,
      seq: 7,
    }).applied).toBe(false);
    expect(resolveSessionTurnRuntime(registry, "s1")).toMatchObject({
      terminal: null,
      canStop: true,
    });
  });
  it("keeps sessions independent", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", state: BackendChannelState.SENDING, seq: 2 });
    sendStart(registry, { sessionId: "s2", turnScopeId: "t2" });
    backendState(registry, { sessionId: "s2", turnScopeId: "t2", state: BackendChannelState.SENDING, seq: 2 });
    backendState(registry, { sessionId: "s2", turnScopeId: "t2", state: BackendChannelState.COMPLETED, seq: 3 });
    expect(turnRuntimeDisplayState(resolveSessionTurnRuntime(registry, "s1"))).toBe("sending");
    expect(turnRuntimeDisplayState(resolveSessionTurnRuntime(registry, "s2"))).toBe("completing");
  });
  it("exposes a session-scoped UI projection and never leaks another session's run", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", state: BackendChannelState.SENDING, seq: 2 });

    expect(selectSessionTurnRuntime(registry, "s1")).toMatchObject({
      sessionId: "s1", sending: true, canStop: true, displayState: "sending",
    });
    expect(selectSessionTurnRuntime(registry, "s2")).toMatchObject({
      sessionId: "s2", sending: false, canStop: false, displayState: "send",
    });

    backendState(registry, { sessionId: "s1", turnScopeId: "t1", state: BackendChannelState.COMPLETED, seq: 3 });
    expect(selectSessionTurnRuntime(registry, "s2")).toMatchObject({ sending: false, canStop: false });
  });
  it("exposes message runtime only for the owning session and turn", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", state: BackendChannelState.SENDING, seq: 2 });

    expect(selectTurnMessageRuntime(registry, { sessionId: "s1", turnScopeId: "t1" })).toMatchObject({
      sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1",
      state: "frontend_processing", backendState: BackendChannelState.SENDING, seq: 2,
    });
    expect(selectTurnMessageRuntime(registry, { sessionId: "s1", dialogProcessId: "dp1" })).toMatchObject({ turnScopeId: "t1" });
    expect(selectTurnMessageRuntime(registry, { sessionId: "s2", turnScopeId: "t1" })).toBeNull();
    expect(selectTurnMessageRuntime(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "other" })).toBeNull();
  });
  it("derives continue from the stopped turn", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", state: BackendChannelState.SENDING, seq: 2 });
    applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED, sessionId: "s1", turnScopeId: "t1", seq: 3 });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", state: BackendChannelState.USER_STOPPED, seq: 4 });
    applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED, sessionId: "s1", turnScopeId: "t1", seq: 5 });
    expect(turnRuntimeDisplayState(resolveSessionTurnRuntime(registry, "s1"))).toBe("continue");
    expect(resolveLatestStoppedTurn(registry, "s1")?.turnScopeId).toBe("t1");
  });
  it("hydrates authoritative terminal statuses", () => {
    const registry = createTurnRuntimeRegistryState();
    hydrateSessionTurnRuntime(registry, { backendSessionId: "s1" }, [
      { status: "user_stopped", turnScopeId: "t1", dialogProcessId: "dp1" },
      { status: "completed", turnScopeId: "t2", dialogProcessId: "dp2" },
    ]);
    expect(registry.turns.t1).toMatchObject({ terminal: "user_stopped", canStop: false });
    expect(registry.turns.t2).toMatchObject({ terminal: "completed", canStop: false });
  });
});
