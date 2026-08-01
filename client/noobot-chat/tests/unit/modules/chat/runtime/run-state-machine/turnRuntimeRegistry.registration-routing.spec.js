/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, it, expect } from "vitest";
import {
  createTurnRuntimeRegistryState,
  confirmTurnRuntimeDeletion,
  applyTurnRuntimeEvent,
  resolveSessionTurnRuntime,
  resolveLatestContinuableStoppedTurn,
  resolveLatestStoppedTurn,
  resolveTurnRuntimeByScope,
  removeTurnRuntime,
  removeSessionRuntime,
  pruneTerminalTurns,
  selectSessionTurnRuntime,
  selectTurnMessageRuntime,
  turnRuntimeDisplayState,
  applyTurnLifecycleEnvelope,
  applyTurnLifecycleSnapshot,
  applyTurnTimingSnapshot,
  applyTurnTerminalResolution,
  applyExecutionSnapshot,
  applyExecutionTree,
  executionTurnKey,
  isTurnRuntimeDeleted,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { SESSION_RUN_EVENT, BackendChannelState } from "../../../../../../src/modules/chat/runtime/run-state-machine/constants.js";
import {
  backendState,
  lifecycle,
  sendStart,
  settleTerminal,
  snapshot,
} from "./turnRuntimeRegistryTestFixtures.js";

describe("turnRuntimeRegistry: registration and routing", () => {
  it("indexes canonical Execution Turn identities per Session and removes only the targeted Session", () => {
    const registry = createTurnRuntimeRegistryState();
    const execution = (executionId, sessionId, turnScopeId) => ({
      protocolVersion: 1,
      executionId,
      rootExecutionId: executionId,
      parentExecutionId: "",
      executionKind: "agent",
      userId: "u1",
      sessionId,
      turnScopeId,
      revision: 1,
      sequence: 1,
    });

    expect(applyExecutionSnapshot(registry, execution("e1", "s1", "workflow-node:shared")).applied).toBe(true);
    expect(applyExecutionSnapshot(registry, execution("e2", "s2", "workflow-node_shared")).applied).toBe(true);
    expect(registry.executionIdByTurnScopeId[executionTurnKey("s1", "workflow-node_shared")]).toBe("e1");
    expect(registry.executionIdByTurnScopeId[executionTurnKey("s2", "workflow-node:shared")]).toBe("e2");

    applyExecutionTree(registry, {
      rootExecutionId: "e1",
      tree: { executions: { e1: registry.executions.e1 } },
      removedExecutions: [{ executionId: "e1", revision: 2, sequence: 2 }],
    });
    expect(registry.executionIdByTurnScopeId[executionTurnKey("s1", "workflow-node_shared")]).toBeUndefined();
    expect(registry.executionIdByTurnScopeId[executionTurnKey("s2", "workflow-node_shared")]).toBe("e2");
  });
  it("creates and activates a session turn", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    expect(resolveSessionTurnRuntime(registry, "s1")).toMatchObject({ turnScopeId: "t1" });
    expect(turnRuntimeDisplayState(resolveSessionTurnRuntime(registry, "s1"))).toBe("requesting");
  });
  it("binds backend identity without deriving stop eligibility from transport", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", state: BackendChannelState.SENDING, seq: 2 });
    expect(resolveSessionTurnRuntime(registry, "s1")).toMatchObject({ dialogProcessId: "dp1", canStop: false, transportState: "sending" });
    expect(registry.routeIndex.dp1).toEqual({ sessionId: "s1", turnScopeId: "t1" });
  });
  it("uses authoritative lifecycle capabilities for stop eligibility", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    lifecycle(registry, {
      sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1",
      eventType: "turn.action_accepted", state: "action_requesting", phase: "action",
      executionState: "accepted", revision: 1, sequence: 1, canStop: false,
    });
    lifecycle(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1" });
    expect(resolveSessionTurnRuntime(registry, "s1")).toMatchObject({
      state: "frontend_processing", canStop: true, commandPending: false,
    });
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
      displayState: "requesting",
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
    expect(result.turn).toMatchObject({ turnScopeId: "t1", transportState: "completed", commandPending: true });
    expect(result.turn.state).toBeUndefined();
  });
  it("locks terminal turns and rejects stale or conflicting events", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1", seq: 5 });
    expect(backendState(registry, { sessionId: "s1", turnScopeId: "t1", state: BackendChannelState.SENDING, seq: 2 }).applied).toBe(true);
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", state: BackendChannelState.SENDING, seq: 6 });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", state: BackendChannelState.COMPLETED, seq: 7 });
    settleTerminal(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", revision: 8, sequence: 8 });
    expect(backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp2", state: BackendChannelState.SENDING, seq: 7 }).applied).toBe(false);
    expect(resolveTurnRuntimeByScope(registry, "t1", { sessionId: "s1" })).toMatchObject({ terminal: "completed", canStop: false });
  });

  it("rejects an old Turn event after a newer Turn owns the same session", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "old" });
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      eventType: "turn.action_accepted",
      sessionId: "s1", turnScopeId: "old", dialogProcessId: "dp-old", seq: 2,
    });
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      eventType: "turn.processing_started",
      sessionId: "s1", turnScopeId: "old", dialogProcessId: "dp-old", seq: 3,
    });
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      eventType: "turn.processing_completed",
      sessionId: "s1", turnScopeId: "old", dialogProcessId: "dp-old", seq: 4,
    });
    settleTerminal(registry, { sessionId: "s1", turnScopeId: "old", dialogProcessId: "dp-old", revision: 5, sequence: 5 });
    sendStart(registry, { sessionId: "s1", turnScopeId: "new" });
    const late = applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      sessionId: "s1",
      turnScopeId: "old",
      state: BackendChannelState.SENDING,
      seq: 99,
    });
    expect(late.applied).toBe(false);
    expect(resolveTurnRuntimeByScope(registry, "old", { sessionId: "s1" })).toMatchObject({
      turnScopeId: "old", state: "frontend_completed", terminal: "completed",
    });
  });

  it("rejects a mismatched dialog identity without mutating the Turn", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      eventType: "turn.action_accepted",
      sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", seq: 2,
    });
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      eventType: "turn.processing_started",
      sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", seq: 3,
    });
    const before = JSON.stringify(resolveSessionTurnRuntime(registry, "s1"));
    const dialogMismatch = backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp-other", state: BackendChannelState.COMPLETED, seq: 3 });
    expect(dialogMismatch).toMatchObject({ applied: false, reason: "dialog_process_identity_conflict" });
    expect(JSON.stringify(resolveSessionTurnRuntime(registry, "s1"))).toBe(before);
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

    expect(lateSending.applied).toBe(true);
    expect(resolveSessionTurnRuntime(registry, "s1")).toMatchObject({
      commandPending: true,
      canStop: false,
    });
  });
  it("keeps sessions independent", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", state: BackendChannelState.SENDING, seq: 2 });
    sendStart(registry, { sessionId: "s2", turnScopeId: "t2" });
    backendState(registry, { sessionId: "s2", turnScopeId: "t2", state: BackendChannelState.SENDING, seq: 2 });
    backendState(registry, { sessionId: "s2", turnScopeId: "t2", state: BackendChannelState.COMPLETED, seq: 3 });
    expect(turnRuntimeDisplayState(resolveSessionTurnRuntime(registry, "s1"))).toBe("requesting");
    expect(turnRuntimeDisplayState(resolveSessionTurnRuntime(registry, "s2"))).toBe("requesting");
  });
  it("uses canonical workflow Turn scope at the Store boundary", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "workflow-node:turn-1" });
    backendState(registry, {
      sessionId: "s1",
      turnScopeId: "workflow-node:turn-1",
      dialogProcessId: "dp1",
      state: BackendChannelState.SENDING,
      seq: 2,
    });

    expect(Object.keys(registry.sessions.s1.turns)).toEqual(["workflow-node:turn-1"]);
    expect(selectTurnMessageRuntime(registry, {
      sessionId: "s1",
      turnScopeId: "workflow-node:turn-1",
    })).toMatchObject({
      turnScopeId: "workflow-node:turn-1",
      running: true,
    });
  });
  it("isolates identical canonical Turn scopes by Session", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "workflow-node:shared" });
    sendStart(registry, { sessionId: "s2", turnScopeId: "workflow-node_shared" });
    backendState(registry, {
      sessionId: "s1", turnScopeId: "workflow-node_shared", dialogProcessId: "dp1",
      state: BackendChannelState.SENDING, seq: 2,
    });
    backendState(registry, {
      sessionId: "s2", turnScopeId: "workflow-node:shared", dialogProcessId: "dp2",
      state: BackendChannelState.SENDING, seq: 2,
    });
    lifecycle(registry, {
      sessionId: "s1", turnScopeId: "workflow-node_shared", dialogProcessId: "dp1",
      eventType: "turn.action_accepted", state: "action_requesting", phase: "action",
      executionState: "accepted", revision: 1, sequence: 1, canStop: false,
    });
    lifecycle(registry, {
      sessionId: "s2", turnScopeId: "workflow-node_shared", dialogProcessId: "dp2",
      eventType: "turn.action_accepted", state: "action_requesting", phase: "action",
      executionState: "accepted", revision: 1, sequence: 1, canStop: false,
    });
    lifecycle(registry, {
      sessionId: "s1", turnScopeId: "workflow-node_shared", dialogProcessId: "dp1",
      revision: 2, sequence: 2,
    });
    lifecycle(registry, {
      sessionId: "s2", turnScopeId: "workflow-node_shared", dialogProcessId: "dp2",
      revision: 2, sequence: 2,
    });

    expect(selectTurnMessageRuntime(registry, {
      sessionId: "s1", turnScopeId: "workflow-node_shared",
    })?.dialogProcessId).toBe("dp1");
    expect(selectTurnMessageRuntime(registry, {
      sessionId: "s2", turnScopeId: "workflow-node_shared",
    })?.dialogProcessId).toBe("dp2");
  });
  it("exposes a session-scoped UI projection and never leaks another session's run", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", state: BackendChannelState.SENDING, seq: 2 });

    expect(selectSessionTurnRuntime(registry, "s1")).toMatchObject({
      sessionId: "s1", sending: true, canStop: false, displayState: "requesting",
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
      state: "", backendState: BackendChannelState.SENDING, seq: 0,
    });
    expect(selectTurnMessageRuntime(registry, { sessionId: "s1", dialogProcessId: "dp1" })).toMatchObject({ turnScopeId: "t1" });
    expect(selectTurnMessageRuntime(registry, { sessionId: "s2", turnScopeId: "t1" })).toBeNull();
    expect(selectTurnMessageRuntime(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "other" })).toMatchObject({
      sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", running: true,
    });
  });
  it("derives continue from the stopped turn", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", state: BackendChannelState.SENDING, seq: 2 });
    applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED, sessionId: "s1", turnScopeId: "t1", seq: 3 });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", state: BackendChannelState.USER_STOPPED, seq: 4 });
    settleTerminal(registry, { sessionId: "s1", turnScopeId: "t1", state: "stop_completed", revision: 5, sequence: 5 });
    expect(turnRuntimeDisplayState(resolveLatestContinuableStoppedTurn(registry, "s1"))).toBe("continue");
    expect(resolveLatestStoppedTurn(registry, "s1")?.turnScopeId).toBe("t1");
  });
  it("hydrates an authoritative action request that arrives before any local Turn", () => {
    const registry = createTurnRuntimeRegistryState();
    const result = applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      eventType: "turn.action_accepted",
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "dp1",
      action: "send",
      revision: 1,
      sequence: 1,
    });

    expect(result).toMatchObject({
      applied: true,
      turn: {
        state: "frontend_action_requesting",
        action: "send",
        lifecycleObserved: true,
        terminal: null,
      },
    });
    expect(registry.routeIndex.dp1).toEqual({ sessionId: "s1", turnScopeId: "t1" });
  });

  it("rejects an error that arrives before Turn identity is established", () => {
    const registry = createTurnRuntimeRegistryState();
    const result = applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      eventType: "turn.failed",
      phase: "processing",
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "dp1",
      revision: 1,
      sequence: 1,
      error: { message: "early failure" },
    });

    expect(result).toMatchObject({ applied: false, reason: "illegal_transition" });
    expect(registry.sessions.s1).toBeUndefined();
    expect(registry.routeIndex.dp1).toBeUndefined();
  });

});
