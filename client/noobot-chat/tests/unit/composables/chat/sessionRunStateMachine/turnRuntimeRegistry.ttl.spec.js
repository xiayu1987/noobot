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
  resolveTurnRuntimeByScope,
} from "../../../../../src/composables/chat/sessionRunStateMachine/turnRuntimeRegistry";
import { BackendChannelState, SESSION_RUN_EVENT } from "../../../../../src/composables/chat/sessionRunStateMachine/constants";

const completion = (sessionId, turnScopeId, dialogProcessId) => ({
  type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED,
  sessionId, turnScopeId, dialogProcessId,
  source: "final_session_detail",
});

function hydrateCompletionRequest(registry, sessionId, turnScopeId, dialogProcessId) {
  applyTurnRuntimeEvent(registry, {
    type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
    sessionId, turnScopeId, seq: 1,
  });
  applyTurnRuntimeEvent(registry, {
    type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
    sessionId, turnScopeId, dialogProcessId,
    state: BackendChannelState.SENDING, seq: 2,
  });
  applyTurnRuntimeEvent(registry, {
    type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
    sessionId, turnScopeId, dialogProcessId,
    state: BackendChannelState.COMPLETED, seq: 3,
  });
}

describe("turnRuntimeRegistry deferred lifecycle TTL", () => {
  it("replays before expiry but rejects the exact expiry boundary", () => {
    let now = 100;
    const before = createTurnRuntimeRegistryState({ now: () => now, deferredLifecycleEventTtlMs: 10 });
    applyTurnRuntimeEvent(before, completion("s1", "t1", "dp1"));
    now = 109;
    hydrateCompletionRequest(before, "s1", "t1", "dp1");
    expect(resolveTurnRuntimeByScope(before, "t1", { sessionId: "s1" })?.terminal).toBe("completed");

    now = 200;
    const boundary = createTurnRuntimeRegistryState({ now: () => now, deferredLifecycleEventTtlMs: 10 });
    applyTurnRuntimeEvent(boundary, completion("s1", "t1", "dp1"));
    now = 210;
    hydrateCompletionRequest(boundary, "s1", "t1", "dp1");
    expect(resolveTurnRuntimeByScope(boundary, "t1", { sessionId: "s1" })).toMatchObject({
      state: "frontend_completion_requesting", terminal: null,
    });
    expect(boundary.pendingLifecycleEvents).toEqual({});
  });

  it("does not let duplicate observations or Session alias promotion extend lifetime", () => {
    let now = 100;
    const registry = createTurnRuntimeRegistryState({ now: () => now, deferredLifecycleEventTtlMs: 20 });
    applyTurnRuntimeEvent(registry, completion("local", "t1", "dp1"));
    const original = { ...registry.pendingLifecycleEvents["local::t1"] };
    now = 115;
    applyTurnRuntimeEvent(registry, { ...completion("local", "t1", "dp1"), eventId: "duplicate" });
    expect(registry.pendingLifecycleEvents["local::t1"]).toMatchObject({
      enqueuedAtMs: original.enqueuedAtMs,
      expiresAtMs: original.expiresAtMs,
      eventId: "duplicate",
    });

    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
      sessionId: "local", turnScopeId: "t1", seq: 1,
    });
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      sessionId: "canonical", turnScopeId: "t1", dialogProcessId: "dp1",
      state: BackendChannelState.SENDING, seq: 2,
    });
    expect(registry.pendingLifecycleEvents["canonical::t1"]?.expiresAtMs).toBe(120);
    now = 120;
    applyTurnRuntimeEvent(registry, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      sessionId: "canonical", turnScopeId: "t1", dialogProcessId: "dp1",
      state: BackendChannelState.COMPLETED, seq: 3,
    });
    expect(resolveTurnRuntimeByScope(registry, "t1", { sessionId: "canonical" })?.terminal).toBeNull();
    expect(registry.pendingLifecycleEvents).toEqual({});
  });

  it("expires identities independently and explicit cleanup is idempotent", () => {
    let now = 0;
    const registry = createTurnRuntimeRegistryState({ now: () => now, deferredLifecycleEventTtlMs: 10 });
    applyTurnRuntimeEvent(registry, completion("main", "shared", "dp-main"));
    now = 5;
    applyTurnRuntimeEvent(registry, completion("child", "shared", "dp-child"));
    now = 10;
    expect(pruneExpiredPendingLifecycleEvents(registry).removedKeys).toEqual(["main::shared"]);
    expect(Object.keys(registry.pendingLifecycleEvents)).toEqual(["child::shared"]);
    expect(pruneExpiredPendingLifecycleEvents(registry).removedKeys).toEqual([]);
    now = 15;
    expect(pruneExpiredPendingLifecycleEvents(registry).removedKeys).toEqual(["child::shared"]);
    expect(registry.pendingLifecycleEvents).toEqual({});
  });
});
