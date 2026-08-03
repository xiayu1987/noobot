/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthoritativeExecutionReadModel,
  createAuthoritativeTurnSnapshot,
  queryAuthoritativeExecution,
  queryAuthoritativeExecutionTree,
  resolveAuthoritativeTurnTerminal,
} from "../src/application/index.js";

const now = "2026-07-30T00:00:00.000Z";
const turn = (overrides = {}) => ({
  turnScopeId: "turn-1",
  messageId: "message-1",
  presentationMessageId: "message-1",
  executionId: "agent:turn-1",
  rootExecutionId: "agent:turn-1",
  state: "processing",
  phase: "processing",
  executionState: "sending",
  revision: 2,
  sequence: 2,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

test("authority builds active and terminal snapshot from one lifecycle rule", () => {
  const snapshot = createAuthoritativeTurnSnapshot({
    lifecycle: {
      activeTurnScopeId: "turn-1",
      sequence: 3,
      turns: {
        active: turn(),
        terminal: turn({ turnScopeId: "turn-0", executionId: "agent:turn-0", rootExecutionId: "agent:turn-0", state: "completed", phase: "completion", sequence: 1 }),
      },
    },
    turnTimings: [{ turnScopeId: "turn-1", thinkingStartedAt: "2026-07-29T23:59:00.000Z" }],
    commandId: "snapshot-1",
    userId: "u1",
    sessionId: "s1",
    terminalTurnScopeIds: ["turn-0"],
    knownSequence: 3,
    generatedAt: now,
  });
  assert.equal(snapshot.activeTurn.startedAt, "2026-07-29T23:59:00.000Z");
  assert.deepEqual(snapshot.recentTerminalTurns.map((item) => item.turnScopeId), ["turn-0"]);
  assert.equal(snapshot.unchanged, true);
});

test("authority snapshots only terminal Turns represented by canonical messages", () => {
  const snapshot = createAuthoritativeTurnSnapshot({
    lifecycle: {
      sequence: 3,
      turns: {
        retained: turn({ turnScopeId: "turn-retained", state: "completed", sequence: 2 }),
        deleted: turn({ turnScopeId: "turn-deleted", state: "stop_completed", sequence: 3 }),
      },
    },
    terminalTurnScopeIds: ["turn-retained"],
    commandId: "snapshot-message-projection",
    userId: "u1",
    sessionId: "s1",
    generatedAt: now,
  });

  assert.deepEqual(
    snapshot.recentTerminalTurns.map((item) => item.turnScopeId),
    ["turn-retained"],
  );
});

test("authority owns terminal readiness decisions", () => {
  const lifecycle = { turns: { active: turn() } };
  assert.equal(resolveAuthoritativeTurnTerminal({ lifecycle, commandId: "resolve-1", sessionId: "s1", turnScopeId: "missing" }).reason, "turn_not_found");
  assert.equal(resolveAuthoritativeTurnTerminal({ lifecycle, commandId: "resolve-1", sessionId: "s1", turnScopeId: "turn-1" }).reason, "turn_not_terminal");

  lifecycle.turns.active = turn({ state: "completed", phase: "completion", terminalStatus: { status: "completed" } });
  const resolved = resolveAuthoritativeTurnTerminal({ lifecycle, commandId: "resolve-1", sessionId: "s1", turnScopeId: "turn-1" });
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.turn.terminalStatus.status, "completed");
});

test("authority execution read model excludes conflicting ownership and builds trees", () => {
  const readModel = buildAuthoritativeExecutionReadModel([
    { sessionId: "root", turnLifecycle: { turns: { root: turn() } } },
    { sessionId: "child", parentSessionId: "root", turnLifecycle: { turns: { child: turn({ turnScopeId: "child", executionId: "agent:child", parentExecutionId: "agent:turn-1", rootExecutionId: "agent:turn-1" }) } } },
    { sessionId: "left", turnLifecycle: { turns: { left: turn({ executionId: "agent:conflict" }) } } },
    { sessionId: "right", turnLifecycle: { turns: { right: turn({ executionId: "agent:conflict" }) } } },
  ]);
  assert.equal(queryAuthoritativeExecution(readModel, { executionId: "agent:conflict" }).reason, "execution_identity_conflict");
  const tree = queryAuthoritativeExecutionTree(readModel, { executionId: "agent:child", generatedAt: now });
  assert.equal(tree.rootExecutionId, "agent:turn-1");
  assert.deepEqual(tree.tree.executions["agent:turn-1"].childExecutionIds, ["agent:child"]);
});
