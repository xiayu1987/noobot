/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  mapSummaryToSession,
  mergeExistingSessionState,
  reconcileSessionObject,
} from "../../../../src/composables/chat/chatList/sessionRecords";

const helpers = {
  sessionTitleFromMessages: (messages, fallback = "") => messages?.[0]?.content || fallback || "title",
  createConnectorPanelState: () => ({ selectedConnectors: {} }),
};

function summaryWithTerminalSnapshot(overrides = {}) {
  return {
    sessionId: "s-refresh",
    caller: "user",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:01:00.000Z",
    messages: [],
    turnLifecycleSnapshot: {
      protocolVersion: 1,
      eventType: "turn.snapshot",
      sessionId: "s-refresh",
      sequence: 2,
      activeTurnScopeId: "",
      activeTurn: null,
      recentTerminalTurns: [{
        turnScopeId: "t-refresh",
        dialogProcessId: "dp-refresh",
        state: "completed",
        phase: "completion",
        sequence: 2,
        revision: 2,
        capabilities: { canStop: false },
      }],
    },
    turnStatuses: [{ status: "completed", turnScopeId: "t-refresh", dialogProcessId: "dp-refresh" }],
    turnTimings: [{
      turnScopeId: "t-refresh",
      dialogProcessId: "dp-refresh",
      thinkingStartedAt: "2026-07-10T00:00:10.000Z",
      thinkingFinishedAt: "2026-07-10T00:00:45.000Z",
    }],
    ...overrides,
  };
}

describe("sessionRecords terminal discovery metadata", () => {
  it("preserves terminal discovery fields through summary mapping", () => {
    const mapped = mapSummaryToSession(summaryWithTerminalSnapshot(), helpers);
    expect(mapped.turnLifecycleSnapshot?.recentTerminalTurns?.[0]?.state).toBe("completed");
    expect(mapped.turnStatuses).toEqual([
      { status: "completed", turnScopeId: "t-refresh", dialogProcessId: "dp-refresh" },
    ]);
    expect(mapped.turnTimings).toEqual([expect.objectContaining({
      turnScopeId: "t-refresh",
      thinkingStartedAt: "2026-07-10T00:00:10.000Z",
      thinkingFinishedAt: "2026-07-10T00:00:45.000Z",
    })]);
  });

  it("uses neutral discovery defaults when a summary omits the fields", () => {
    const mapped = mapSummaryToSession({ sessionId: "s-empty", caller: "user", messages: [] }, helpers);
    expect(mapped.turnLifecycleSnapshot).toBeNull();
    expect(mapped.turnStatuses).toEqual([]);
    expect(mapped.turnTimings).toEqual([]);
  });

  it("prefers fresh discovery metadata and retains existing metadata for a partial summary", () => {
    const discovered = mapSummaryToSession(summaryWithTerminalSnapshot(), helpers);
    const partial = mapSummaryToSession({ sessionId: "s-refresh", caller: "user", messages: [] }, helpers);

    const fresh = mergeExistingSessionState(discovered, {
      turnLifecycleSnapshot: null,
      turnStatuses: [],
    }, helpers);
    expect(fresh.turnLifecycleSnapshot?.recentTerminalTurns?.[0]?.state).toBe("completed");

    const retained = mergeExistingSessionState(partial, discovered, helpers);
    expect(retained.turnLifecycleSnapshot?.recentTerminalTurns?.[0]?.state).toBe("completed");
    expect(retained.turnStatuses).toHaveLength(1);
    expect(retained.turnTimings).toHaveLength(1);
  });

  it("keeps terminal discovery metadata during in-place reconciliation", () => {
    const mapped = mapSummaryToSession(summaryWithTerminalSnapshot(), helpers);
    const existing = mapSummaryToSession({ sessionId: "s-refresh", caller: "user", messages: [] }, helpers);
    const reconciled = reconcileSessionObject(mapped, existing, helpers);

    expect(reconciled).toBe(existing);
    expect(reconciled.turnLifecycleSnapshot?.recentTerminalTurns?.[0]?.state).toBe("completed");
    expect(reconciled.turnStatuses).toHaveLength(1);
    expect(reconciled.turnTimings).toHaveLength(1);
  });
});
