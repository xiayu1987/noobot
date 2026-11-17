/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, it, expect } from "vitest";
import {
  applyTurnLifecycleSnapshot,
  createTurnRuntimeRegistryState,
  resolveTurnRuntimeByScope,
  isTurnRuntimeDeleted,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { snapshot, lifecycle } from "./turnRuntimeRegistryTestFixtures.js";

const terminal = (turnScopeId, sequence) => ({
  turnScopeId,
  dialogProcessId: `dialog-${turnScopeId}`,
  state: "completed",
  sequence,
});

describe("lifecycle snapshot query reconciliation", () => {
  it("deduplicates fresh requests and keeps authoritative changes distinct from query metadata", () => {
    const registry = createTurnRuntimeRegistryState();
    expect(applyTurnLifecycleSnapshot(registry, snapshot()).applied).toBe(true);
    const turn = registry.sessions.s1.turns.t1;
    expect(
      applyTurnLifecycleSnapshot(
        registry,
        snapshot({
          commandId: "another-query",
          unchanged: true,
          generatedAt: "2026-01-01T00:00:10.000Z",
        }),
      ),
    ).toMatchObject({ deduplicated: true, reason: "duplicate_snapshot" });
    expect(registry.sessions.s1.turns.t1).toBe(turn);
    expect(
      applyTurnLifecycleSnapshot(
        registry,
        snapshot({ activeTurn: { ...snapshot().activeTurn, commandId: "contradictory" } }),
      ),
    ).toMatchObject({ applied: false, reason: "snapshot_sequence_conflict" });
    expect(registry.sessions.s1.turns.t1).toBe(turn);
  });

  it("applies narrower and wider windows at the same sequence without deleting messages or accepting late events", () => {
    const registry = createTurnRuntimeRegistryState();
    const wide = snapshot({
      sequence: 10,
      recentTerminalTurns: [terminal("recent", 8), terminal("older", 4)],
    });
    expect(applyTurnLifecycleSnapshot(registry, wide).applied).toBe(true);
    const narrow = snapshot({
      sequence: 10,
      commandId: "query-limit-one",
      recentTerminalTurns: [terminal("recent", 8)],
    });
    expect(applyTurnLifecycleSnapshot(registry, narrow)).toMatchObject({
      applied: true,
      evictedTurnScopeIds: ["older"],
      replacedTurnScopeIds: [],
    });
    expect(resolveTurnRuntimeByScope(registry, "older", { sessionId: "s1" })).toBeNull();
    expect(isTurnRuntimeDeleted(registry, { sessionId: "s1", turnScopeId: "older" })).toBe(false);
    expect(registry.sessions.s1.authoritativeSnapshotObservation.turns).toHaveLength(2);
    expect(
      lifecycle(registry, { turnScopeId: "older", dialogProcessId: "dialog-older", sequence: 4 }),
    ).toMatchObject({ applied: false, reason: "outside_snapshot_window" });
    expect(applyTurnLifecycleSnapshot(registry, wide).applied).toBe(true);
    expect(resolveTurnRuntimeByScope(registry, "older", { sessionId: "s1" })).not.toBeNull();
    expect(registry.sessions.s1.authoritativeSnapshotObservation.turns).toHaveLength(3);
    expect(applyTurnLifecycleSnapshot(registry, snapshot({ sequence: 9 }))).toMatchObject({
      applied: false,
      reason: "stale_snapshot",
    });
  });

  it("hydrates newly committed thinking timing at an unchanged lifecycle sequence", () => {
    const registry = createTurnRuntimeRegistryState();
    const original = snapshot();
    expect(applyTurnLifecycleSnapshot(registry, original).applied).toBe(true);
    const thinkingFinishedAt = "2026-01-01T00:00:01.000Z";
    const timed = snapshot({ activeTurn: { ...original.activeTurn, thinkingFinishedAt } });
    expect(applyTurnLifecycleSnapshot(registry, timed).applied).toBe(true);
    expect(registry.sessions.s1.turns.t1.timing.thinkingFinishedAt).toBe(thinkingFinishedAt);
    expect(applyTurnLifecycleSnapshot(registry, original).deduplicated).toBe(true);
    expect(registry.sessions.s1.turns.t1.timing.thinkingFinishedAt).toBe(thinkingFinishedAt);
    const before = JSON.stringify(registry);
    expect(
      applyTurnLifecycleSnapshot(
        registry,
        snapshot({
          activeTurn: { ...original.activeTurn, thinkingFinishedAt: "2026-01-01T00:00:02.000Z" },
        }),
      ),
    ).toMatchObject({ applied: false, reason: "snapshot_sequence_conflict" });
    expect(JSON.stringify(registry)).toBe(before);
  });

  it("rejects malformed snapshots before reading their identity", () => {
    const registry = createTurnRuntimeRegistryState();
    expect(applyTurnLifecycleSnapshot(registry, null)).toMatchObject({
      applied: false,
      reason: "invalid_authoritative_snapshot",
    });
    expect(registry.sessions).toEqual({});
  });
});
