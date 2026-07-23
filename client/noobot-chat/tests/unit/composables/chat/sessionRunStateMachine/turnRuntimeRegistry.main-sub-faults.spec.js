/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  applyTurnRuntimeEvent,
  createTurnRuntimeRegistryState,
  pruneExpiredPendingLifecycleEvents,
  removeSessionRuntime,
  resolveTurnRuntimeByScope,
} from "../../../../../src/composables/chat/sessionRunStateMachine/turnRuntimeRegistry";
import { BackendChannelState, SESSION_RUN_EVENT } from "../../../../../src/composables/chat/sessionRunStateMachine/constants";

function event(registry, type, sessionId, turnScopeId, dialogProcessId, extra = {}) {
  return applyTurnRuntimeEvent(registry, { type, sessionId, turnScopeId, dialogProcessId, ...extra });
}

function start(registry, sessionId, turnScopeId, dialogProcessId, seq = 1) {
  event(registry, SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED, sessionId, turnScopeId, "", { seq });
  event(registry, SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, sessionId, turnScopeId, dialogProcessId, {
    state: BackendChannelState.SENDING, seq: seq + 1,
  });
}

function requestCompletion(registry, sessionId, turnScopeId, dialogProcessId, seq = 3) {
  event(registry, SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, sessionId, turnScopeId, dialogProcessId, {
    state: BackendChannelState.COMPLETED, seq,
  });
}

const turn = (registry, sessionId, turnScopeId) =>
  resolveTurnRuntimeByScope(registry, turnScopeId, { sessionId });

describe("turnRuntimeRegistry main/sub-session concurrent fault isolation", () => {
  it("replays interleaved early confirmations only into their exact Session identities", () => {
    const registry = createTurnRuntimeRegistryState();
    for (const [sessionId, dialogProcessId] of [["main", "dp-main"], ["child-a", "dp-a"], ["child-b", "dp-b"]]) {
      event(registry, SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED, sessionId, "shared", dialogProcessId);
    }

    // Hydrate in reverse/interleaved order to inject reconnect ordering faults.
    start(registry, "child-b", "shared", "dp-b");
    start(registry, "main", "shared", "dp-main");
    requestCompletion(registry, "main", "shared", "dp-main");
    expect(turn(registry, "main", "shared")?.terminal).toBe("completed");
    expect(turn(registry, "child-b", "shared")?.terminal).toBeNull();
    expect(turn(registry, "child-a", "shared")).toBeNull();

    requestCompletion(registry, "child-b", "shared", "dp-b");
    start(registry, "child-a", "shared", "dp-a");
    requestCompletion(registry, "child-a", "shared", "dp-a");
    expect(turn(registry, "child-a", "shared")?.terminal).toBe("completed");
    expect(turn(registry, "child-b", "shared")?.terminal).toBe("completed");
    expect(registry.pendingLifecycleEvents).toEqual({});
  });

  it("isolates stale, mismatched, stop, and failure events across concurrent Turns", () => {
    const registry = createTurnRuntimeRegistryState();
    start(registry, "main", "main-turn", "dp-main");
    start(registry, "child", "child-turn", "dp-child");

    const mismatched = event(registry, SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, "main", "main-turn", "dp-child", {
      state: BackendChannelState.COMPLETED, seq: 99,
    });
    expect(mismatched).toMatchObject({ applied: false, reason: "dialog_process_identity_conflict" });

    event(registry, SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED, "child", "child-turn", "dp-child", { seq: 3 });
    event(registry, SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, "child", "child-turn", "dp-child", {
      state: BackendChannelState.USER_STOPPED, seq: 4,
    });
    event(registry, SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED, "child", "child-turn", "dp-child", { seq: 5 });

    expect(turn(registry, "child", "child-turn")?.terminal).toBe("user_stopped");
    expect(turn(registry, "main", "main-turn")).toMatchObject({ state: "frontend_processing", terminal: null });

    // A late event from the stopped child cannot target the main Turn.
    const stale = event(registry, SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, "main", "child-turn", "dp-child", {
      state: BackendChannelState.ERROR, seq: 6, error: "late child failure",
    });
    expect(stale.applied).toBe(false);
    expect(turn(registry, "main", "main-turn")?.terminal).toBeNull();
  });

  it("keeps TTL cleanup and Session deletion scoped while another Session completes", () => {
    let now = 0;
    const registry = createTurnRuntimeRegistryState({ now: () => now, deferredLifecycleEventTtlMs: 10 });
    event(registry, SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED, "main", "t", "dp-main");
    now = 5;
    event(registry, SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED, "child", "t", "dp-child");
    now = 10;
    expect(pruneExpiredPendingLifecycleEvents(registry).removedKeys).toEqual(["main::t"]);

    start(registry, "child", "t", "dp-child");
    requestCompletion(registry, "child", "t", "dp-child");
    expect(turn(registry, "child", "t")?.terminal).toBe("completed");

    // Create and remove only the main Session; child terminal state is monotonic.
    start(registry, "main", "new-main", "dp-main-new");
    expect(removeSessionRuntime(registry, "main")).toBe(true);
    expect(turn(registry, "child", "t")?.terminal).toBe("completed");
    expect(registry.sessions.main).toBeUndefined();
  });

  it("promotes one optimistic child alias without moving the main Session pending event", () => {
    const registry = createTurnRuntimeRegistryState();
    event(registry, SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED, "main", "main-turn", "dp-main");
    event(registry, SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED, "child-local", "child-turn", "dp-child");
    event(registry, SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED, "child-local", "child-turn", "", { seq: 1 });
    event(registry, SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, "child-canonical", "child-turn", "dp-child", {
      state: BackendChannelState.SENDING, seq: 2,
    });

    expect(registry.pendingLifecycleEvents["main::main-turn"]).toBeTruthy();
    expect(registry.pendingLifecycleEvents["child-local::child-turn"]).toBeUndefined();
    expect(registry.pendingLifecycleEvents["child-canonical::child-turn"]).toBeTruthy();
    requestCompletion(registry, "child-canonical", "child-turn", "dp-child");
    expect(turn(registry, "child-canonical", "child-turn")?.terminal).toBe("completed");
    expect(registry.pendingLifecycleEvents["main::main-turn"]).toBeTruthy();
  });
});
