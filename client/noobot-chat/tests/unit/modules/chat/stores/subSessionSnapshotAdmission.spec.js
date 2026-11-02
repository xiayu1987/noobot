/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createTurnLifecycleSnapshot } from "@noobot/session-protocol";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";
import { canonicalWorkflowSessionSnapshot } from "../helpers/workflowRuntimeEventFixture.js";

const sessionId = "snapshot-child";
const turnScopeId = "workflow-node:node-1";
const dialogProcessId = "dialog-1";
const timing = (modelLoopRound) => ({ turnScopeId, dialogProcessId, modelLoopRound });

function snapshot(aggregateVersion, sequence, turnTimings = []) {
  return canonicalWorkflowSessionSnapshot({
    executionId: "agent-execution:snapshot-child",
    nodeSessionId: sessionId,
    nodeExecutionId: "node-1",
    aggregateVersion,
    messages: [],
    turnTimings,
    turnLifecycleSnapshot: createTurnLifecycleSnapshot({
      sessionId,
      sequence,
      commandId: `command-${sequence}`,
      activeTurnScopeId: "",
      activeTurn: null,
      recentTerminalTurns: [],
      replacedTurns: [],
      unchanged: false,
      recovery: "none",
      generatedAt: "2026-11-01T00:00:00.000Z",
    }),
  });
}

function apply(store, event) {
  return store.applyWorkflowRuntimeEvent(event, { source: "test_snapshot" });
}

describe("sub-session snapshot domain admission", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("hydrates timing facts from a duplicate message snapshot", () => {
    const store = useChatStore();
    apply(store, snapshot(2, 2));
    const result = apply(store, snapshot(2, 2, [timing(3)]));
    expect(result).toMatchObject({ applied: false, reason: "duplicate_snapshot_version" });
    expect(store.turnRuntimeRegistry.sessions[sessionId].turns[turnScopeId].timing).toEqual(
      timing(3),
    );
  });

  it("advances lifecycle and timing without replacing messages from an older aggregate", () => {
    const store = useChatStore();
    apply(store, snapshot(3, 1));
    const result = apply(store, snapshot(2, 2, [timing(4)]));
    expect(result).toMatchObject({ applied: false, reason: "stale_snapshot" });
    const bucket = store.turnRuntimeRegistry.sessions[sessionId];
    expect(bucket.authoritativeSequence).toBe(2);
    expect(bucket.turns[turnScopeId].timing).toEqual(timing(4));
    expect(store.selectSubSessionMessages(sessionId).messages).toEqual([]);
  });

  it("propagates timing conflicts, retains accepted lifecycle, and does not commit messages", () => {
    const store = useChatStore();
    apply(store, snapshot(1, 1, [timing(3)]));
    expect(() => apply(store, snapshot(2, 2, [timing(4)]))).toThrow(
      expect.objectContaining({ code: "SESSION_TURN_TIMING_CONFLICT" }),
    );
    const bucket = store.turnRuntimeRegistry.sessions[sessionId];
    expect(bucket.authoritativeSequence).toBe(2);
    expect(bucket.turns[turnScopeId].timing).toEqual(timing(3));
    expect(apply(store, snapshot(2, 2, [timing(3)]))).toMatchObject({ applied: true });
  });

  it("rejects stale lifecycle before timing and message projection", () => {
    const store = useChatStore();
    apply(store, snapshot(1, 3));
    expect(apply(store, snapshot(2, 2, [timing(4)]))).toMatchObject({
      applied: false,
      reason: "stale_snapshot",
      lifecycleResult: { applied: false, reason: "stale_snapshot" },
    });
    expect(store.turnRuntimeRegistry.sessions[sessionId].turns[turnScopeId]).toBeUndefined();
    expect(apply(store, snapshot(2, 3, [timing(4)]))).toMatchObject({ applied: true });
  });
});
