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
    expect(selectSessionTurnRuntime(registry, "s-refresh", terminalTurn.turnScopeId)).toMatchObject({
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

  it("keeps stopping after real-time user_stopped until the authoritative summary is applied", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "t1", seq: 1 });
    lifecycle(registry, {
      eventType: "turn.action_accepted", state: "action_requesting", phase: "action",
      executionState: "accepted", revision: 1, sequence: 1, canStop: false,
    });
    lifecycle(registry, { revision: 2, sequence: 2 });
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
    lifecycle(registry, {
      eventType: "turn.stop_accepted", state: "stopping", phase: "stop", action: "stop",
      executionState: "stopping", revision: 3, sequence: 3, canStop: false,
    });
    lifecycle(registry, {
      eventType: "turn.stop_processing_completed", state: "stopping", phase: "stop", action: "stop",
      executionState: "stopping", revision: 4, sequence: 4, canStop: false,
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
    lifecycle(registry, {
      eventType: "turn.action_accepted", state: "action_requesting", phase: "action",
      executionState: "accepted", revision: 1, sequence: 1, canStop: false,
    });
    lifecycle(registry, { revision: 2, sequence: 2 });
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
    const authoritativeSuccess = applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE, eventType: successEvent,
      sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1", sequence: 7,
    });
    expect(authoritativeSuccess).toMatchObject({ applied: false, reason: "terminal_locked" });
    expect(resolveTurnRuntimeByScope(registry, "t1", { sessionId: "s1" })).toMatchObject({ terminal: "error" });
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
    lifecycle(registry, {
      eventType: "turn.action_accepted", state: "action_requesting", phase: "action",
      executionState: "accepted", revision: 1, sequence: 1, canStop: false,
    });
    lifecycle(registry, { revision: 2, sequence: 2 });
    lifecycle(registry, {
      eventType: "turn.processing_completed", state: "completion_requesting", phase: "completion",
      executionState: "completed", revision: 3, sequence: 3, canStop: false,
    });
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
    lifecycle(registry, {
      sessionId: "backend-session", eventType: "turn.action_accepted", state: "action_requesting", phase: "action",
      executionState: "accepted", revision: 1, sequence: 1, canStop: false,
    });
    lifecycle(registry, { sessionId: "backend-session", revision: 2, sequence: 2 });
    lifecycle(registry, {
      sessionId: "backend-session", eventType: "turn.processing_completed", state: "completion_requesting", phase: "completion",
      executionState: "completed", revision: 3, sequence: 3, canStop: false,
    });
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
    lifecycle(registry, {
      sessionId: "s1", turnScopeId: "new", dialogProcessId: "new-dp",
      eventType: "turn.action_accepted", state: "action_requesting", phase: "action",
      executionState: "accepted", revision: 1, sequence: 1, canStop: false,
    });
    lifecycle(registry, { sessionId: "s1", turnScopeId: "new", dialogProcessId: "new-dp", revision: 2, sequence: 2 });
    lifecycle(registry, {
      sessionId: "s1", turnScopeId: "new", dialogProcessId: "new-dp",
      eventType: "turn.processing_completed", state: "completion_requesting", phase: "completion",
      executionState: "completed", revision: 3, sequence: 3, canStop: false,
    });
    backendState(registry, { sessionId: "s1", turnScopeId: "new", dialogProcessId: "new-dp", state: BackendChannelState.SENDING, seq: 2 });
    backendState(registry, { sessionId: "s1", turnScopeId: "new", dialogProcessId: "new-dp", state: BackendChannelState.COMPLETED, seq: 3 });

    expect(resolveTurnRuntimeByScope(registry, "new", { sessionId: "s1" })).toMatchObject({
      state: "frontend_completion_requesting",
      terminal: null,
    });
    expect(resolveTurnRuntimeByScope(registry, "old", { sessionId: "s1" })).toBeNull();
  });
