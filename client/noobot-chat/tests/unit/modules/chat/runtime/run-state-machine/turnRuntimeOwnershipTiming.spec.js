/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect, it } from "vitest";
import {
  createInitialSessionRunState,
  FrontendRunState,
  resolveSessionRunMessageRuntimePatch,
  resolveSessionRunStateForMessage,
} from "../../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import {
  applyTurnLifecycleSnapshot,
  createTurnRuntimeRegistryState,
  pruneTerminalTurns,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import { settleTerminal, snapshot } from "./turnRuntimeRegistryTestFixtures.js";

it.each(["", undefined, "other-session", " s1 "])(
  "does not project a run with session identity %s into an active session",
  (sessionId) => {
    const messageItem = {
      role: "assistant",
      pending: true,
      dialogProcessId: "dp1",
      turnScopeId: "t1",
      channelState: { state: "sending" },
    };
    const activeSession = {
      sessionId: "s1",
      messages: [messageItem, { role: "assistant", pending: false }],
    };
    const stateSnapshot = {
      ...createInitialSessionRunState(),
      sessionId,
      state: FrontendRunState.PROCESSING,
      dialogProcessId: "dp1",
      turnScopeId: "t1",
    };
    expect(
      resolveSessionRunStateForMessage({ stateSnapshot, messageItem, activeSession }),
    ).toBeNull();
    expect(
      resolveSessionRunMessageRuntimePatch({ stateSnapshot, messageItem, activeSession }),
    ).toEqual({ action: "none" });
  },
);

it("uses the authoritative finish time for both event and snapshot retention", () => {
  const live = createTurnRuntimeRegistryState();
  const hydrated = createTurnRuntimeRegistryState();
  const finishedAt = "2026-01-01T00:00:01.000Z";
  const resolved = settleTerminal(live, { turnScopeId: "old", finishedAt });
  expect(resolved.applied).toBe(true);
  expect(resolved.turn.finishedAtMs).toBe(Date.parse(finishedAt));
  const document = snapshot({
    activeTurn: null,
    activeTurnScopeId: "",
    sequence: 100,
    recentTerminalTurns: [
      {
        turnScopeId: "old",
        dialogProcessId: "dp1",
        state: "completed",
        finishedAt,
        updatedAt: "2026-01-01T00:00:03.000Z",
      },
    ],
  });
  expect(applyTurnLifecycleSnapshot(hydrated, document).applied).toBe(true);
  expect(hydrated.sessions.s1.turns.old.finishedAtMs).toBe(resolved.turn.finishedAtMs);
  for (const registry of [live, hydrated]) {
    settleTerminal(registry, {
      turnScopeId: "latest",
      dialogProcessId: "dp-latest",
      sequence: 101,
      finishedAt: "2026-01-01T00:00:04.000Z",
    });
    expect(
      pruneTerminalTurns(registry, {
        sessionId: "s1",
        referencedTurnScopeIds: [],
        maxAgeMs: 1500,
        nowMs: Date.parse("2026-01-01T00:00:04.000Z"),
      }).removedTurnScopeIds,
    ).toEqual(["old"]);
  }
});
