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
  hydrateSessionTurnRuntime,
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
  sendStart,
  settleTerminal,
  snapshot,
} from "./turnRuntimeRegistryTestFixtures.js";

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

  it("tombstones a confirmed deletion and rejects late replay for the same Session Turn", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "deleted-turn" });

    expect(confirmTurnRuntimeDeletion(registry, "deleted-turn", { sessionId: "s1" }).applied).toBe(true);
    expect(isTurnRuntimeDeleted(registry, {
      sessionId: "s1",
      turnScopeId: "deleted-turn",
    })).toBe(true);

    const replayed = backendState(registry, {
      sessionId: "s1",
      turnScopeId: "deleted-turn",
      dialogProcessId: "dp-deleted",
      state: BackendChannelState.SENDING,
      seq: 2,
    });

    expect(replayed).toMatchObject({ applied: false, reason: "deleted_turn_tombstoned" });
    expect(resolveTurnRuntimeByScope(registry, "deleted-turn", { sessionId: "s1" })).toBeNull();
  });

  it("does not tombstone ordinary runtime pruning", () => {
    const registry = createTurnRuntimeRegistryState();
    sendStart(registry, { sessionId: "s1", turnScopeId: "pruned-turn" });

    expect(removeTurnRuntime(registry, "pruned-turn", { sessionId: "s1" })).toBe(true);
    expect(isTurnRuntimeDeleted(registry, {
      sessionId: "s1",
      turnScopeId: "pruned-turn",
    })).toBe(false);
    expect(sendStart(registry, { sessionId: "s1", turnScopeId: "pruned-turn" }).applied).toBe(true);
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
