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
  sendStart,
  settleTerminal,
  snapshot,
} from "./turnRuntimeRegistryTestFixtures.js";

describe("turnRuntimeRegistry: hydration and snapshots", () => {
  it("hydrates every persisted turn timing without creating lifecycle authority", () => {
    const registry = createTurnRuntimeRegistryState();
    const result = applyTurnTimingSnapshot(registry, {
      sessionId: "s1",
      turnTimings: [
        {
          turnScopeId: "client-turn:first",
          dialogProcessId: "dp-first",
          thinkingStartedAt: "2026-07-21T10:00:00.000Z",
          thinkingFinishedAt: "2026-07-21T10:00:15.000Z",
        },
        {
          turnScopeId: "client-turn:second",
          dialogProcessId: "dp-second",
          thinkingStartedAt: "2026-07-21T11:00:00.000Z",
          thinkingFinishedAt: "2026-07-21T11:00:09.000Z",
        },
      ],
    });

    expect(result).toMatchObject({ applied: true, hydratedTurnScopeIds: ["client-turn:first", "client-turn:second"] });
    const first = resolveTurnRuntimeByScope(registry, "client-turn:first", { sessionId: "s1" });
    expect(first).toMatchObject({
      startedAt: "2026-07-21T10:00:00.000Z",
      finishedAt: "2026-07-21T10:00:15.000Z",
    });
    expect(first).not.toHaveProperty("state");
    expect(first).not.toHaveProperty("terminal");
    expect(resolveTurnRuntimeByScope(registry, "client-turn:second", { sessionId: "s1" })?.finishedAt)
      .toBe("2026-07-21T11:00:09.000Z");
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

});
