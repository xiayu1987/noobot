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
  resolveTurnRuntimeByScope,
  removeTurnRuntime,
  removeSessionRuntime,
  pruneTerminalTurns,
  selectSessionTurnRuntime,
  selectTurnMessageRuntime,
  turnRuntimeDisplayState,
  hydrateSessionTurnRuntime,
  applyTurnLifecycleEnvelope,
  applyTurnLifecycleSnapshot,
  applyTurnTerminalResolution,
  applyExecutionSnapshot,
  applyExecutionTree,
  executionTurnKey,
} from "../../../../../src/composables/chat/sessionRunStateMachine/turnRuntimeRegistry";
import { SESSION_RUN_EVENT, BackendChannelState } from "../../../../../src/composables/chat/sessionRunStateMachine/constants";
import { createTurnTerminalResolution } from "../../../../../../../shared/turn-lifecycle-protocol.mjs";

function sendStart(registry, { sessionId, turnScopeId, seq = 1 }) {
  return applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED, sessionId, turnScopeId, seq });
}
function backendState(registry, { sessionId, turnScopeId, dialogProcessId, state, seq }) {
  return applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, sessionId, turnScopeId, dialogProcessId, state, seq });
}

let terminalResolutionSequence = 0;
function settleTerminal(registry, {
  sessionId = "s1", turnScopeId = "t1", state = "completed", dialogProcessId = "",
  revision = 100, sequence = 100, completionCommitId = "", summaryVersion = 0,
  failure = null, finalizeIntent = null, materialization = {}, startedAt = "", finishedAt = "",
} = {}) {
  terminalResolutionSequence += 1;
  const resolvedCommitId = completionCommitId || `commit-${turnScopeId}-${revision}`;
  const resolvedSummaryVersion = summaryVersion || revision;
  const terminalFailure = state.endsWith("_failed")
    ? (failure || { phase: state.replace(/_failed$/, ""), message: `${state} terminal failure`, retryable: false })
    : failure;
  return applyTurnTerminalResolution(registry, createTurnTerminalResolution({
    commandId: `terminal-resolution-${terminalResolutionSequence}`,
    sessionId,
    turnScopeId,
    resolved: true,
    turn: {
      turnScopeId,
      dialogProcessId,
      state,
      phase: state.replace(/_failed$/, ""),
      revision,
      sequence,
      completionCommitId: resolvedCommitId,
      summaryVersion: resolvedSummaryVersion,
      failure: terminalFailure,
      finalizeIntent,
      startedAt,
      finishedAt,
      capabilities: { actionLocked: false, canStop: false },
      updatedAt: "2026-01-01T00:00:03.000Z",
    },
    materialization: {
      completionCommitId: resolvedCommitId,
      summaryVersion: resolvedSummaryVersion,
      revision,
      sequence,
      terminalStatus: { status: state },
      messages: [],
      ...materialization,
    },
  }));
}

function snapshot(overrides = {}) {
  const activeTurn = overrides.activeTurn === undefined ? {
    turnScopeId: "t1", dialogProcessId: "dp1", commandId: "c1", action: "send",
    state: "processing", phase: "processing", executionState: "sending",
    revision: 2, sequence: 2, summaryVersion: 0, failure: null,
    capabilities: { actionLocked: true, canStop: true },
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:01.000Z",
  } : overrides.activeTurn;
  return {
    protocolVersion: 1, eventType: "turn.snapshot", commandId: "snapshot-1",
    userId: "u1", sessionId: "s1", sequence: 2,
    activeTurnScopeId: activeTurn?.turnScopeId || "", activeTurn,
    recentTerminalTurns: [], unchanged: false, generatedAt: "2026-01-01T00:00:02.000Z",
    ...overrides,
  };
}

describe("turnRuntimeRegistry", () => {
  it("does not compare reconnect transport sequence with terminal lifecycle sequence", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s-refresh", turnScopeId: "t-refresh", seq: 1 });
    expect(backendState(registry, {
      sessionId: "s-refresh",
      turnScopeId: "t-refresh",
      dialogProcessId: "dp-refresh",
      state: BackendChannelState.SENDING,
      seq: 163,
    }).applied).toBe(true);

    const settled = settleTerminal(registry, {
      sessionId: "s-refresh",
      turnScopeId: "t-refresh",
      dialogProcessId: "dp-refresh",
      revision: 4,
      sequence: 4,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:02:00.000Z",
    });
    expect(settled).toMatchObject({
      applied: true,
      turn: {
        terminal: "completed",
        state: "frontend_completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:02:00.000Z",
      },
    });
  });

  it("settles a same-revision terminal snapshot even when its execution state is still sending", () => {
    const registry = createTurnRuntimeRegistryState();
    const terminalTurn = {
      turnScopeId: "t-refresh-snapshot",
      dialogProcessId: "dp-refresh-snapshot",
      commandId: "t-refresh-snapshot:completed",
      action: "send",
      state: "completed",
      phase: "completion",
      executionState: "sending",
      revision: 4,
      sequence: 4,
      summaryVersion: 0,
      completionCommitId: "t-refresh-snapshot:completed",
      failure: null,
      capabilities: { actionLocked: false, canStop: false },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:03.000Z",
    };

    const hydrated = applyTurnLifecycleSnapshot(registry, snapshot({
      sessionId: "s-refresh",
      sequence: 4,
      activeTurnScopeId: "",
      activeTurn: null,
      recentTerminalTurns: [terminalTurn],
    }));
    expect(hydrated.applied).toBe(true);

    const resolved = settleTerminal(registry, {
      sessionId: "s-refresh",
      turnScopeId: terminalTurn.turnScopeId,
      dialogProcessId: terminalTurn.dialogProcessId,
      revision: 4,
      sequence: 4,
      completionCommitId: terminalTurn.completionCommitId,
    });

    expect(resolved).toMatchObject({
      applied: true,
      turn: {
        state: "frontend_completed",
        backendState: "completed",
        terminal: "completed",
        terminalResolved: true,
        canStop: false,
      },
    });
    expect(selectSessionTurnRuntime(registry, "s-refresh")).toMatchObject({
      sending: false,
      canStop: false,
      terminal: "completed",
    });
  });

  it("does not promote an optimistic Session from a terminal response", () => {
    const registry = createTurnRuntimeRegistryState();
    const localSessionId = "local-session-1";
    const canonicalSessionId = "backend-session-1";

    expect(sendStart(registry, {
      sessionId: localSessionId,
      turnScopeId: "t-refresh",
    }).applied).toBe(true);
    expect(selectSessionTurnRuntime(registry, localSessionId)).toMatchObject({ sending: true });

    const resolved = settleTerminal(registry, {
      sessionId: canonicalSessionId,
      turnScopeId: "t-refresh",
      revision: 4,
      sequence: 4,
    });

    expect(resolved.applied).toBe(true);
    expect(registry.sessionAliases[localSessionId]).toBeUndefined();
    expect(registry.sessions[localSessionId]).toBeDefined();
    expect(registry.sessions[canonicalSessionId].turns["t-refresh"]).toMatchObject({
      sessionId: canonicalSessionId,
      terminal: "completed",
      terminalResolved: true,
    });
    expect(selectSessionTurnRuntime(registry, canonicalSessionId)).toMatchObject({
      sending: false,
      canStop: false,
    });
  });

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
  it("binds backend identity and exposes stop eligibility", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", state: BackendChannelState.SENDING, seq: 2 });
    expect(resolveSessionTurnRuntime(registry, "s1")).toMatchObject({ dialogProcessId: "dp1", canStop: true });
    expect(registry.routeIndex.dp1).toEqual({ sessionId: "s1", turnScopeId: "t1" });
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
    expect(result.turn).toMatchObject({ turnScopeId: "t1", state: "frontend_completion_requesting", terminal: null });
  });
  it("locks terminal turns and rejects stale or conflicting events", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1", seq: 5 });
    expect(backendState(registry, { sessionId: "s1", turnScopeId: "t1", state: BackendChannelState.SENDING, seq: 2 }).applied).toBe(false);
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", state: BackendChannelState.SENDING, seq: 6 });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", state: BackendChannelState.COMPLETED, seq: 7 });
    settleTerminal(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", revision: 8, sequence: 8 });
    expect(backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp2", state: BackendChannelState.SENDING, seq: 7 }).applied).toBe(false);
    expect(resolveSessionTurnRuntime(registry, "s1")).toMatchObject({ terminal: "completed", canStop: false });
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

    const summarized = settleTerminal(registry, {
      sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1",
      state: "stop_completed", revision: 5, sequence: 5,
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
  it("canonicalizes workflow Turn scope variants at the Store boundary", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "workflow-node:turn-1" });
    backendState(registry, {
      sessionId: "s1",
      turnScopeId: "workflow-node_turn-1",
      dialogProcessId: "dp1",
      state: BackendChannelState.SENDING,
      seq: 2,
    });

    expect(Object.keys(registry.sessions.s1.turns)).toEqual(["workflow-node_turn-1"]);
    expect(selectTurnMessageRuntime(registry, {
      sessionId: "s1",
      turnScopeId: "workflow-node:turn-1",
    })).toMatchObject({
      turnScopeId: "workflow-node_turn-1",
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
    expect(turnRuntimeDisplayState(resolveSessionTurnRuntime(registry, "s1"))).toBe("continue");
    expect(resolveLatestStoppedTurn(registry, "s1")?.turnScopeId).toBe("t1");
  });
  it("treats legacy terminal statuses as discovery data only", () => {
    const registry = createTurnRuntimeRegistryState();
    hydrateSessionTurnRuntime(registry, { backendSessionId: "s1" }, [
      { status: "user_stopped", turnScopeId: "t1", dialogProcessId: "dp1" },
      { status: "completed", turnScopeId: "t2", dialogProcessId: "dp2" },
    ]);
    expect(resolveTurnRuntimeByScope(registry, "t1", { sessionId: "s1" })).toBeNull();
    expect(resolveTurnRuntimeByScope(registry, "t2", { sessionId: "s1" })).toBeNull();
    expect(selectSessionTurnRuntime(registry, "s1")).toMatchObject({
      sending: false,
      displayState: "send",
    });
  });

  it("does not let a legacy non-terminal status create a running Turn", () => {
    const registry = createTurnRuntimeRegistryState();
    hydrateSessionTurnRuntime(registry, { backendSessionId: "s1" }, [
      { status: "sending", turnScopeId: "t1", dialogProcessId: "dp1" },
    ]);

    expect(resolveTurnRuntimeByScope(registry, "t1", { sessionId: "s1" })).toBeNull();
    expect(registry.sessions.s1).toBeUndefined();
    expect(registry.routeIndex.dp1).toBeUndefined();
    expect(selectSessionTurnRuntime(registry, "s1")).toMatchObject({
      sending: false,
      canStop: false,
      displayState: "send",
    });
  });

  it("restores persisted turn timing instead of using hydration update time", () => {
    const registry = createTurnRuntimeRegistryState();
    const persistedStartedAt = "2026-07-21T10:00:00.000Z";
    const hydrationUpdatedAt = "2026-07-21T10:30:00.000Z";
    hydrateSessionTurnRuntime(registry, {
      backendSessionId: "s1",
      turnTimings: [{
        turnScopeId: "t1",
        thinkingStartedAt: persistedStartedAt,
        thinkingFinishedAt: "2026-07-21T10:00:15.000Z",
      }],
    }, [{
      status: "completed",
      turnScopeId: "t1",
      updatedAt: hydrationUpdatedAt,
    }]);

    expect(resolveTurnRuntimeByScope(registry, "t1", { sessionId: "s1" })).toBeNull();
    expect(registry.sessions.s1).toBeUndefined();
  });

  it("strictly validates snapshots and rejects same-sequence content conflicts", () => {
    const registry = createTurnRuntimeRegistryState();
    expect(applyTurnLifecycleSnapshot(registry, { ...snapshot(), commandId: "" })).toMatchObject({
      applied: false, reason: "invalid_authoritative_snapshot",
    });
    expect(applyTurnLifecycleSnapshot(registry, snapshot())).toMatchObject({ applied: true });
    expect(applyTurnLifecycleSnapshot(registry, snapshot())).toMatchObject({
      applied: false, deduplicated: true, reason: "duplicate_snapshot",
    });
    expect(applyTurnLifecycleSnapshot(registry, snapshot({ generatedAt: "2026-01-01T00:00:03.000Z" }))).toMatchObject({
      applied: false, reason: "snapshot_sequence_conflict",
    });
  });

  it("rejects malformed authoritative lifecycle envelopes before reducing them", () => {
    const registry = createTurnRuntimeRegistryState();
    const result = applyTurnLifecycleEnvelope(registry, {
      protocolVersion: 1,
      eventType: "turn.action_accepted",
      eventId: "",
      sessionId: "s1",
      turnScopeId: "t1",
      revision: 1,
      sequence: 1,
    });
    expect(result).toMatchObject({
      applied: false,
      reason: "invalid_authoritative_envelope",
      errors: expect.arrayContaining(["missing_event_id"]),
    });
    expect(registry.sessions.s1).toBeUndefined();
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

  it.each([
    {
      name: "completion",
      failedPhase: "completion",
      failedState: "frontend_completion_error",
      successEvent: "turn.completed",
      terminal: "completed",
      prepare(registry) {
        sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
        applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: "turn.action_accepted", sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", sequence: 2 });
        applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: "turn.processing_started", sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", sequence: 3 });
        applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: "turn.processing_completed", sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", sequence: 4 });
      },
    },
    {
      name: "stop",
      failedPhase: "stop",
      failedState: "frontend_stop_error",
      successEvent: "turn.stop_completed",
      terminal: "user_stopped",
      prepare(registry) {
        sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
        applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: "turn.action_accepted", sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", sequence: 2 });
        applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: "turn.processing_started", sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", sequence: 3 });
        backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", state: BackendChannelState.SENDING, seq: 3 });
        applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED, sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", sequence: 4 });
        applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: "turn.stop_processing_completed", sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", sequence: 5 });
      },
    },
  ])("allows only the matching authoritative success to settle a retryable $name failure", ({ prepare, failedPhase, failedState, successEvent, terminal }) => {
    const registry = createTurnRuntimeRegistryState();
    prepare(registry);
    const failureTerminalState = failedPhase === "stop" ? "stop_failed" : "completion_failed";
    const failed = settleTerminal(registry, {
      state: failureTerminalState, revision: 6, sequence: 6,
      failure: { phase: failedPhase, message: "retryable" }, finalizeIntent: { retryable: true },
    });
    expect(failed.turn).toMatchObject({ state: failedState, terminal: "error", finalizeIntent: { retryable: true } });
    // A resolved terminal is monotonic. Recovery must create a newer committed
    // server view rather than letting a lifecycle notification overwrite it.
    const authoritativeSuccess = applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: successEvent,
      sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", sequence: 7,
    });
    expect(authoritativeSuccess).toMatchObject({ applied: false, reason: "terminal_locked" });
    expect(resolveTurnRuntimeByScope(registry, "t1", { sessionId: "s1" })).toMatchObject({ terminal: "error" });
  });

  it("an empty active snapshot releases routing while retaining recent terminal turns", () => {
    const registry = createTurnRuntimeRegistryState();
    applyTurnLifecycleSnapshot(registry, snapshot());
    const terminal = { ...snapshot().activeTurn, turnScopeId: "done", dialogProcessId: "dp-done", state: "completed", phase: "completion", executionState: "completed", revision: 3, sequence: 3, capabilities: { actionLocked: false, canStop: false } };
    const result = applyTurnLifecycleSnapshot(registry, snapshot({
      commandId: "snapshot-2", sequence: 3, activeTurn: null, activeTurnScopeId: "", recentTerminalTurns: [terminal],
    }));
    expect(result.applied).toBe(true);
    expect(registry.routeIndex.dp1).toBeUndefined();
    expect(resolveTurnRuntimeByScope(registry, "done", { sessionId: "s1" })).toBeNull();
    expect(settleTerminal(registry, { turnScopeId: "done", dialogProcessId: "dp-done", revision: 4, sequence: 4 }).applied).toBe(true);
    expect(resolveTurnRuntimeByScope(registry, "done", { sessionId: "s1" })).toMatchObject({ terminal: "completed" });
  });

  it("does not let channel state move a snapshot-owned Turn phase", () => {
    const registry = createTurnRuntimeRegistryState();
    applyTurnLifecycleSnapshot(registry, snapshot());

    backendState(registry, {
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "dp1",
      state: BackendChannelState.COMPLETED,
      seq: 999,
    });

    expect(resolveSessionTurnRuntime(registry, "s1")).toMatchObject({
      state: "frontend_processing",
      lifecycleObserved: true,
      terminal: null,
    });

    const completed = applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      eventType: "turn.processing_completed",
      phase: "completion",
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "dp1",
      revision: 3,
      sequence: 3,
    });
    expect(completed).toMatchObject({ applied: true, turn: { state: "frontend_completion_requesting", seq: 3 } });
  });

  it("never lets legacy hydration take ownership before or after a snapshot", () => {
    const registry = createTurnRuntimeRegistryState();
    hydrateSessionTurnRuntime(registry, { backendSessionId: "s1" }, [
      { status: "completed", turnScopeId: "legacy", dialogProcessId: "legacy-dp" },
    ]);
    expect(resolveTurnRuntimeByScope(registry, "legacy", { sessionId: "s1" })).toBeNull();
    applyTurnLifecycleSnapshot(registry, snapshot());
    const before = JSON.stringify(registry.sessions.s1);
    hydrateSessionTurnRuntime(registry, { backendSessionId: "s1" }, [
      { status: "user_stopped", turnScopeId: "late-legacy", dialogProcessId: "late-dp" },
    ]);
    expect(JSON.stringify(registry.sessions.s1)).toBe(before);
    expect(resolveTurnRuntimeByScope(registry, "late-legacy", { sessionId: "s1" })).toBeNull();
  });

  it("does not let an early detail acknowledgement settle a Turn", () => {
    const registry = createTurnRuntimeRegistryState();
    const early = applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED,
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "dp1",
      source: "final_session_detail",
    });
    expect(early).toMatchObject({ applied: false, reason: "missing_state" });

    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", state: BackendChannelState.SENDING, seq: 2 });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", state: BackendChannelState.COMPLETED, seq: 3 });

    expect(resolveTurnRuntimeByScope(registry, "t1", { sessionId: "s1" })).toMatchObject({
      state: "frontend_completion_requesting", terminal: null,
    });
    expect(settleTerminal(registry, { revision: 4, sequence: 4 }).applied).toBe(true);
    expect(resolveTurnRuntimeByScope(registry, "t1", { sessionId: "s1" })).toMatchObject({ terminal: "completed" });
  });

  it("promotes an optimistic Session without using deferred detail as terminal authority", () => {
    const registry = createTurnRuntimeRegistryState();
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED,
      sessionId: "local-session",
      turnScopeId: "t1",
      dialogProcessId: "dp1",
    });
    sendStart(registry, { sessionId: "local-session", turnScopeId: "t1" });
    backendState(registry, { sessionId: "backend-session", turnScopeId: "t1", dialogProcessId: "dp1", state: BackendChannelState.SENDING, seq: 2 });
    backendState(registry, { sessionId: "backend-session", turnScopeId: "t1", dialogProcessId: "dp1", state: BackendChannelState.COMPLETED, seq: 3 });

    expect(registry.sessionAliases["local-session"]).toBe("backend-session");
    expect(resolveTurnRuntimeByScope(registry, "t1", { sessionId: "backend-session" })).toMatchObject({
      state: "frontend_completion_requesting", terminal: null,
    });
    expect(settleTerminal(registry, { sessionId: "backend-session", revision: 4, sequence: 4 }).applied).toBe(true);
  });

  it("does not let a newer non-terminal snapshot reopen a completed Turn", () => {
    const registry = createTurnRuntimeRegistryState();
    applyTurnLifecycleSnapshot(registry, snapshot({
      sequence: 3,
      activeTurn: { ...snapshot().activeTurn, state: "completed", phase: "completion", executionState: "completed", revision: 3, sequence: 3 },
    }));
    settleTerminal(registry, { revision: 4, sequence: 4 });
    applyTurnLifecycleSnapshot(registry, snapshot({
      commandId: "snapshot-late",
      sequence: 5,
      activeTurn: { ...snapshot().activeTurn, state: "completion_requesting", phase: "completion", revision: 5, sequence: 5 },
    }));

    expect(resolveTurnRuntimeByScope(registry, "t1", { sessionId: "s1" })).toMatchObject({
      state: "frontend_completed",
      terminal: "completed",
    });
  });

  it("uses Session + Turn scope as terminal authority despite a changed dialog route", () => {
    const registry = createTurnRuntimeRegistryState();
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED,
      sessionId: "s1",
      turnScopeId: "t1",
      dialogProcessId: "old-dp",
      source: "final_session_detail",
    });
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "new-dp", state: BackendChannelState.SENDING, seq: 2 });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "new-dp", state: BackendChannelState.COMPLETED, seq: 3 });

    const resolved = settleTerminal(registry, { dialogProcessId: "", revision: 4, sequence: 4 });
    expect(resolved).toMatchObject({ applied: true, turn: { state: "frontend_completed", terminal: "completed" } });
  });

  it("completes a normal request when final detail carries a different dialog route", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "runtime-dp", state: BackendChannelState.SENDING, seq: 2 });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "runtime-dp", state: BackendChannelState.COMPLETED, seq: 3 });

    const completed = settleTerminal(registry, { dialogProcessId: "message-dp", revision: 4, sequence: 4 });

    expect(completed).toMatchObject({ applied: true, turn: { state: "frontend_completed", terminal: "completed" } });
  });

  it("discards repeated legacy detail acknowledgements and never completes another Turn", () => {
    const registry = createTurnRuntimeRegistryState();
    const confirmation = {
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED,
      sessionId: "s1",
      turnScopeId: "old",
      dialogProcessId: "old-dp",
      source: "final_session_detail",
    };
    applyTurnRuntimeEvent(registry, confirmation);
    applyTurnRuntimeEvent(registry, confirmation);
    sendStart(registry, { sessionId: "s1", turnScopeId: "new" });
    backendState(registry, { sessionId: "s1", turnScopeId: "new", dialogProcessId: "new-dp", state: BackendChannelState.SENDING, seq: 2 });
    backendState(registry, { sessionId: "s1", turnScopeId: "new", dialogProcessId: "new-dp", state: BackendChannelState.COMPLETED, seq: 3 });

    expect(resolveTurnRuntimeByScope(registry, "new", { sessionId: "s1" })).toMatchObject({
      state: "frontend_completion_requesting",
      terminal: null,
    });
    expect(resolveTurnRuntimeByScope(registry, "old", { sessionId: "s1" })).toBeNull();
  });

  it("does not retain legacy detail acknowledgements when Turns or Sessions are removed", () => {
    const registry = createTurnRuntimeRegistryState();
    for (const turnScopeId of ["t1", "t2"]) {
      applyTurnRuntimeEvent(registry, {
        type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED,
        sessionId: "s1",
        turnScopeId,
        dialogProcessId: `dp-${turnScopeId}`,
      });
    }
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    expect(removeTurnRuntime(registry, "t1", { sessionId: "s1" })).toBe(true);
    expect(resolveTurnRuntimeByScope(registry, "t2", { sessionId: "s1" })).toBeNull();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t2" });
    expect(removeSessionRuntime(registry, "s1")).toBe(true);
    expect(registry.sessions.s1).toBeUndefined();
  });

  it("prunes old or excess terminal turns per session while protecting active, stopped, and referenced turns", () => {
    const registry = createTurnRuntimeRegistryState();
    const complete = (sessionId, turnScopeId, dialogProcessId, timestamp) => {
      sendStart(registry, { sessionId, turnScopeId, seq: 1 });
      applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, sessionId, turnScopeId, dialogProcessId, state: BackendChannelState.SENDING, seq: 2, timestamp });
      applyTurnRuntimeEvent(registry, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, sessionId, turnScopeId, dialogProcessId, state: BackendChannelState.COMPLETED, seq: 3, timestamp });
      settleTerminal(registry, { sessionId, turnScopeId, dialogProcessId, revision: 4, sequence: 4 });
    };
    complete("s1", "old", "dp-old", 100);
    complete("s1", "referenced", "dp-ref", 200);
    complete("s1", "active", "dp-active", 300);
    complete("s2", "other-session", "dp-other", 100);

    const result = pruneTerminalTurns(registry, {
      sessionId: "s1",
      referencedTurnScopeIds: ["referenced"],
      retainCount: 0,
      maxAgeMs: 50,
      nowMs: 1000,
    });

    expect(result.removedTurnScopeIds).toEqual(["old"]);
    expect(resolveTurnRuntimeByScope(registry, "referenced", { sessionId: "s1" })).not.toBeNull();
    expect(resolveSessionTurnRuntime(registry, "s1")?.turnScopeId).toBe("active");
    expect(resolveTurnRuntimeByScope(registry, "other-session", { sessionId: "s2" })).not.toBeNull();
    expect(registry.routeIndex["dp-old"]).toBeUndefined();
  });

  it("removes a session bucket and only its route index entries", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1" });
    backendState(registry, { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", state: BackendChannelState.SENDING, seq: 2 });
    sendStart(registry, { sessionId: "s2", turnScopeId: "t2" });
    backendState(registry, { sessionId: "s2", turnScopeId: "t2", dialogProcessId: "dp2", state: BackendChannelState.SENDING, seq: 2 });

    expect(removeSessionRuntime(registry, "s1")).toBe(true);
    expect(registry.sessions.s1).toBeUndefined();
    expect(registry.routeIndex.dp1).toBeUndefined();
    expect(resolveSessionTurnRuntime(registry, "s2")?.turnScopeId).toBe("t2");
    expect(registry.routeIndex.dp2).toEqual({ sessionId: "s2", turnScopeId: "t2" });
  });
});
